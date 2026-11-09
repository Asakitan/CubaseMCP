'use strict';

var protocol = require('./protocol');
var commandDefinitions = require('./commands');
var MAX_REQUESTS = 32;
var MAX_IDS = 4096;
var MAX_FRAMES = 1024;
var FRAME_RESERVE = 512;
var FRAMES_PER_IDLE = 4;
var MAX_OBJECTS = 2048;
var MAX_TAGS = 8192;
var MAX_PLUGINS = 8192;
var MAX_INTEGER = 9007199254740991;
var BRIDGE_REVISION = '2026-11-10-coverage-2';

function fail(code, message, details, execution) {
    var error = new Error(message);
    error.code = code;
    if (details !== undefined) error.details = details;
    if (execution !== undefined) error.execution = execution;
    throw error;
}

function method(object, name) {
    if (!object || typeof object[name] !== 'function') {
        fail('API_UNAVAILABLE', 'Required Cubase API method is missing: ' + name, { method: name });
    }
    return object[name];
}

function invoke(object, name, args) {
    return method(object, name).apply(object, args);
}

function finite(value) {
    return typeof value === 'number' && isFinite(value);
}

function integer(value, minimum, maximum) {
    return finite(value) && Math.floor(value) === value && value >= minimum && value <= maximum;
}

function normalized(value) {
    if (!finite(value) || value < 0 || value > 1) fail('INVALID_VALUE', 'Expected a finite value in [0, 1].');
    return value;
}

function hostNumber(value) {
    if (!finite(value)) fail('INVALID_HOST_DATA', 'Cubase returned a non-finite number.');
    return value;
}

function hostCount(value) {
    if (!integer(value, 0, MAX_INTEGER)) fail('INVALID_HOST_DATA', 'Cubase returned an invalid count or ID.');
    return value;
}

function hostText(value) {
    if (typeof value !== 'string') fail('INVALID_HOST_DATA', 'Cubase returned a non-string value.');
    return value;
}

function hostBool(value) {
    if (typeof value !== 'boolean') fail('INVALID_HOST_DATA', 'Cubase returned a non-boolean value.');
    return value;
}

function errorData(error) {
    var result = { code: error.code || 'HOST_ERROR', message: String(error.message || error) };
    if (error.details !== undefined) result.details = error.details;
    if (error.execution !== undefined) result.execution = error.execution;
    return result;
}

function pagination(args) {
    var offset = args.offset === undefined ? 0 : args.offset;
    var limit = args.limit === undefined ? 32 : args.limit;
    if (!integer(offset, 0, MAX_INTEGER) || !integer(limit, 1, 64)) {
        fail('INVALID_ARGUMENT', 'offset must be nonnegative and limit must be in [1, 64].');
    }
    return { offset: offset, limit: limit };
}

function pageResult(args, page, total, items) {
    var next = Math.min(total, page.offset + items.length);
    return { session: args.session, root: args.root, offset: page.offset, limit: page.limit,
        total: total, items: items, truncated: next < total, nextOffset: next < total ? next : null };
}

function createController(api) {
    var driver = invoke(api, 'makeDeviceDriver', ['CubaseAI', 'MCP', 'CubaseAI MCP']);
    var input = invoke(driver.mPorts, 'makeMidiInput', ['CubaseAI MCP To Cubase']);
    var output = invoke(driver.mPorts, 'makeMidiOutput', ['CubaseAI MCP From Cubase']);
    var detection = invoke(invoke(driver, 'makeDetectionUnit', []), 'detectPortPair', [input, output]);
    invoke(detection, 'expectInputNameEquals', ['CubaseAI MCP To Cubase']);
    invoke(detection, 'expectOutputNameEquals', ['CubaseAI MCP From Cubase']);
    method(output, 'sendMidi');
    var page = invoke(driver.mMapping, 'makePage', ['CubaseAI MCP']);
    var host = page.mHostAccess;
    var decoder = protocol.createDecoder();
    var pending = [];
    var outbound = [];
    var seen = Object.create(null);
    var seenCount = 0;
    var activeDevice = null;
    var activeMapping = null;
    var session = null;
    var generation = 0;
    var instance = Date.now().toString(16) + '-' + Math.random().toString(16).slice(2);
    var roots = Object.create(null);
    var rootNames = ['trackSelection', 'mixConsole', 'transport', 'focusedQuickControls'];
    var rootPaths = ['mTrackSelection', 'mMixConsole', 'mTransport', 'mFocusedQuickControls'];
    var controls = Object.create(null);
    var controlGroups = Object.create(null);
    var transportObservation;
    var transportObservationErrors = Object.create(null);
    var observedTrackId = null;
    var commands = Object.create(null);
    var inIdle = false;
    var writingSurface = 0;
    var malformedFrames = 0;
    var droppedResponses = 0;
    var transportError = null;

    function version() {
        var value = hostText(invoke(api.mDefaults && api.mDefaults.mAppVersion, 'getVersionString', []));
        if (!/^16(?:\.|$)/.test(value)) {
            fail('UNSUPPORTED_VERSION', 'This bridge requires Cubase major version 16.', { appVersion: value });
        }
        return value;
    }

    function hostInfo() {
        var info = { session: session, appVersion: version(), application: null, limits: {}, errors: {} };
        var defaults = api.mDefaults;
        var fields = [
            ['application', 'getAppName', hostText],
            ['insertEffects', 'getNumberOfInsertEffectSlots', hostCount],
            ['stripEffects', 'getNumberOfStripEffectSlots', hostCount],
            ['sendSlots', 'getNumberOfSendSlots', hostCount],
            ['quickControls', 'getNumberOfQuickControls', hostCount],
            ['controlRoomTalkback', 'getMaxControlRoomTalkbackChannels', hostCount],
            ['controlRoomExternalInput', 'getMaxControlRoomExternalInputChannels', hostCount],
            ['controlRoomCue', 'getMaxControlRoomCueChannels', hostCount],
            ['controlRoomPhones', 'getMaxControlRoomPhonesChannels', hostCount],
            ['controlRoomMonitor', 'getMaxControlRoomMonitorChannels', hostCount],
            ['maxGainFactor', 'getMaxGainFactor', hostNumber]
        ];
        fields.forEach(function (field) {
            try {
                var value = field[2](invoke(defaults, field[1], []));
                if (field[0] === 'application') info.application = value;
                else info.limits[field[0]] = value;
            } catch (error) {
                if (field[0] !== 'application') info.limits[field[0]] = null;
                info.errors[field[0]] = errorData(error);
            }
        });
        return info;
    }

    function clearRoot(root) {
        root.objects = Object.create(null);
        root.objectCount = 0;
        root.tagCount = 0;
        root.pluginCount = 0;
        root.base = null;
    }

    function makeRoot(key, path) {
        var root = { key: key, path: path, access: null, active: false, error: null, parameterRevision: 0, stage: 'create' };
        clearRoot(root);
        roots[key] = root;
        try {
            if (!host || !host[path]) fail('API_UNAVAILABLE', 'Required host root is missing: ' + path);
            root.access = invoke(host, 'makeDirectAccess', [host[path]]);
            method(root.access, 'activate');
            method(root.access, 'deactivate');
            method(root.access, 'update');
            method(root.access, 'getBaseObjectID');
            var objectRemoved = function (device, mapping, objectId) {
                if (device !== activeDevice || mapping !== activeMapping) return;
                if (objectId === root.base) { clearRoot(root); return; }
                var removed = root.objects[objectId];
                if (!removed) return;
                root.tagCount -= Object.keys(removed.tags).length;
                root.pluginCount -= Object.keys(removed.plugins).length;
                delete root.objects[objectId];
                root.objectCount--;
            };
            root.access.mOnObjectChange = function (device, mapping) {
                if (device !== activeDevice || mapping !== activeMapping) return;
                root.parameterRevision++;
            };
            root.access.mOnObjectWillBeRemoved = objectRemoved;
            root.access.mOnParameterChange = function (device, mapping) {
                if (device !== activeDevice || mapping !== activeMapping) return;
                root.parameterRevision++;
            };
        } catch (error) {
            root.error = errorData(error);
            root.error.details = { stage: root.stage, stack: error.stack ? String(error.stack) : null };
        }
    }

    function refresh(root) {
        if (root.error) fail(root.error.code, root.error.message, root.error.details);
        if (!root.active) fail('API_UNAVAILABLE', 'DirectAccess is not active for ' + root.key);
        root.stage = 'base';
        var base = hostCount(invoke(root.access, 'getBaseObjectID', [activeMapping]));
        if (root.base !== null && root.base !== base) clearRoot(root);
        root.base = base;
        return root;
    }

    function selectedRoot(args) {
        if (typeof args.root !== 'string' || !roots[args.root]) fail('INVALID_ROOT', 'Unknown DirectAccess root.');
        return refresh(roots[args.root]);
    }

    function readIdentity(root, objectId) {
        return {
            uniqueIdString: hostText(invoke(root.access, 'getObjectUniqueIDString', [activeMapping, objectId])),
            uniqueName: hostText(invoke(root.access, 'getObjectUniqueName', [activeMapping, objectId])),
            typeName: hostText(invoke(root.access, 'getObjectTypeName', [activeMapping, objectId]))
        };
    }

    function sameIdentity(left, right) {
        return left.uniqueIdString === right.uniqueIdString && left.uniqueName === right.uniqueName &&
            left.typeName === right.typeName;
    }

    function observeObject(root, objectId) {
        hostCount(objectId);
        var identity = readIdentity(root, objectId);
        var color = invoke(root.access, 'getObjectColor', [activeMapping, objectId]);
        if (!Array.isArray(color) || color.length > 4) fail('INVALID_HOST_DATA', 'Invalid object color.');
        color.forEach(hostNumber);
        var result = { objectId: objectId, uniqueIdString: identity.uniqueIdString,
            uniqueName: identity.uniqueName, typeName: identity.typeName,
            title: hostText(invoke(root.access, 'getObjectTitle', [activeMapping, objectId])),
            color: color.slice(),
            childCount: hostCount(invoke(root.access, 'getNumberOfChildObjects', [activeMapping, objectId])),
            parameterCount: hostCount(invoke(root.access, 'getNumberOfParameters', [activeMapping, objectId])) };
        var known = root.objects[objectId];
        if (known && !sameIdentity(known.identity, identity)) {
            clearRoot(root);
            fail('OBJECT_STALE', 'The observed object identity changed; list objects again.');
        }
        if (!known) {
            if (root.objectCount >= MAX_OBJECTS) fail('OBSERVATION_LIMIT', 'Object tracking limit reached for this root.');
            root.objects[objectId] = { identity: identity, tags: Object.create(null), plugins: Object.create(null) };
            root.objectCount++;
        }
        return result;
    }

    function admittedObject(root, objectId) {
        if (!integer(objectId, 0, MAX_INTEGER) || !root.objects[objectId]) {
            fail('OBJECT_UNOBSERVED', 'Object ID has not been observed in this root and session.');
        }
        var known = root.objects[objectId];
        if (!sameIdentity(known.identity, readIdentity(root, objectId))) {
            clearRoot(root);
            fail('OBJECT_STALE', 'Object identity changed; list objects again.');
        }
        return known;
    }

    function objectsList(args) {
        var bounds = pagination(args);
        var root = selectedRoot(args);
        if (args.parentId === undefined && bounds.offset === 0) {
            root.stage = 'update';
            invoke(root.access, 'update', [activeMapping]);
            clearRoot(root);
            refresh(root);
        }
        var base = observeObject(root, root.base);
        var parent = args.parentId === undefined ? root.base : args.parentId;
        admittedObject(root, parent);
        var total = hostCount(invoke(root.access, 'getNumberOfChildObjects', [activeMapping, parent]));
        var items = [];
        for (var index = bounds.offset; index < Math.min(total, bounds.offset + bounds.limit); index++) {
            var child = hostCount(invoke(root.access, 'getChildObjectID', [activeMapping, parent, index]));
            items.push(observeObject(root, child));
        }
        var result = pageResult(args, bounds, total, items);
        result.baseObjectId = root.base;
        result.baseObject = base;
        result.parentId = parent;
        return result;
    }

    function objectsGet(args) {
        var root = selectedRoot(args);
        admittedObject(root, args.objectId);
        return { session: session, root: args.root, object: observeObject(root, args.objectId) };
    }

    function mixerChannelInfo(args) {
        var root = selectedRoot(args);
        admittedObject(root, args.objectId);
        var visible = hostBool(invoke(root.access, 'isMixerChannelVisible', [activeMapping, args.objectId]));
        var index = invoke(root.access, 'getMixerChannelIndex', [activeMapping, args.objectId]);
        var zone = invoke(root.access, 'getMixerChannelZone', [activeMapping, args.objectId]);
        if (!integer(index, -2147483648, 4294967295) || !integer(zone, -2147483648, 4294967295)) {
            fail('INVALID_HOST_DATA', 'Cubase returned an invalid mixer channel index or zone.');
        }
        return { session: session, root: args.root, objectId: args.objectId,
            visible: visible, index: index, zone: zone };
    }

    function parameterValue(root, objectId, tag) {
        var value = hostNumber(invoke(root.access, 'getParameterProcessValue', [activeMapping, objectId, tag]));
        return { value: value,
            display: hostText(invoke(root.access, 'getParameterDisplayValue', [activeMapping, objectId, tag])),
            plain: hostNumber(invoke(root.access, 'convertParameterProcessValueToPlain', [activeMapping, objectId, tag, value])) };
    }

    function parameterDetails(root, objectId, tag) {
        var item = parameterValue(root, objectId, tag);
        item.tag = tag;
        item.title = hostText(invoke(root.access, 'getParameterTitle', [activeMapping, objectId, tag, 256]));
        item.defaultValue = hostNumber(invoke(root.access, 'getParameterDefaultProcessValue', [activeMapping, objectId, tag]));
        item.defaultDisplay = hostText(invoke(root.access, 'getParameterDefaultDisplayValue', [activeMapping, objectId, tag]));
        item.units = hostText(invoke(root.access, 'getParameterDisplayUnits', [activeMapping, objectId, tag]));
        item.type = hostText(invoke(root.access, 'getParameterProcessValueType', [activeMapping, objectId, tag]));
        item.locked = hostBool(invoke(root.access, 'getParameterEditLockState', [activeMapping, objectId, tag]));
        item.automatable = hostBool(invoke(root.access, 'isParameterAutomatable', [activeMapping, objectId, tag]));
        return item;
    }

    function admittedParameter(root, objectId, tag) {
        var known = admittedObject(root, objectId);
        if (!integer(tag, -2147483648, 4294967295) || known.tags[tag] === undefined) {
            fail('PARAMETER_UNOBSERVED', 'Parameter tag has not been listed for this object and session.');
        }
        var actualTag = invoke(root.access, 'getParameterTagByIndex', [activeMapping, objectId, known.tags[tag]]);
        if (actualTag !== tag) {
            delete known.tags[tag];
            root.tagCount--;
            fail('PARAMETER_STALE', 'The observed parameter index changed; list parameters again.');
        }
        return known;
    }

    function parametersList(args) {
        var bounds = pagination(args);
        var root = selectedRoot(args);
        var known = admittedObject(root, args.objectId);
        var total = hostCount(invoke(root.access, 'getNumberOfParameters', [activeMapping, args.objectId]));
        var items = [];
        for (var index = bounds.offset; index < Math.min(total, bounds.offset + bounds.limit); index++) {
            var tag = invoke(root.access, 'getParameterTagByIndex', [activeMapping, args.objectId, index]);
            if (!integer(tag, -2147483648, 4294967295)) fail('INVALID_HOST_DATA', 'Invalid parameter tag.');
            var item = parameterDetails(root, args.objectId, tag);
            if (known.tags[tag] === undefined) {
                if (root.tagCount >= MAX_TAGS) fail('OBSERVATION_LIMIT', 'Parameter tracking limit reached for this root.');
                root.tagCount++;
            }
            known.tags[tag] = index;
            items.push(item);
        }
        var result = pageResult(args, bounds, total, items);
        result.objectId = args.objectId;
        return result;
    }

    function parametersGet(args) {
        var root = selectedRoot(args);
        admittedParameter(root, args.objectId, args.tag);
        return { session: session, root: args.root, objectId: args.objectId,
            parameter: parameterDetails(root, args.objectId, args.tag) };
    }

    function submitted(work) {
        try {
            return work();
        } catch (error) {
            error.execution = 'submitted';
            throw error;
        }
    }

    function receipt(request, data) {
        data.requestId = request.id;
        data.session = session;
        data.execution = 'submitted';
        return data;
    }

    function parametersSet(request, args) {
        var root = selectedRoot(args);
        admittedParameter(root, args.objectId, args.tag);
        var setter;
        var target = args.value;
        if (args.mode === 'normalized') {
            target = normalized(target);
            setter = method(root.access, 'setParameterProcessValue');
        } else if (args.mode === 'plain') {
            if (!finite(target)) fail('INVALID_VALUE', 'Plain values must be finite numbers.');
            setter = method(root.access, 'setParameterProcessValue');
            var converted = normalized(invoke(root.access, 'convertParameterPlainToProcessValue', [activeMapping, args.objectId, args.tag, target]));
            var roundTrip = hostNumber(invoke(root.access, 'convertParameterProcessValueToPlain', [activeMapping, args.objectId, args.tag, converted]));
            if (Math.abs(roundTrip - target) > 0.0000001 * Math.max(1, Math.abs(target))) {
                fail('INVALID_VALUE', 'Plain value is out of range or cannot be represented without alteration.');
            }
            target = converted;
        } else if (args.mode === 'display') {
            if (typeof target !== 'string' || !target.length || target.length > 4096) {
                fail('INVALID_VALUE', 'Display values must be nonempty strings of at most 4096 characters.');
            }
            setter = method(root.access, 'setParameterDisplayValue');
        } else {
            fail('INVALID_ARGUMENT', 'mode must be normalized, plain, or display.');
        }
        var before = parameterValue(root, args.objectId, args.tag);
        if (args.expectedValue !== undefined && hostNumber(args.expectedValue) !== before.value) {
            fail('VALUE_CONFLICT', 'Observed value does not match expectedValue.', { actualValue: before.value });
        }
        if (hostBool(invoke(root.access, 'getParameterEditLockState', [activeMapping, args.objectId, args.tag]))) {
            fail('PARAMETER_LOCKED', 'The parameter is edit-locked.');
        }
        return submitted(function () {
            setter.call(root.access, activeMapping, args.objectId, args.tag, target);
            var after = root.objects[args.objectId] ? parameterValue(root, args.objectId, args.tag) : null;
            return receipt(request, { root: args.root, objectId: args.objectId, tag: args.tag,
                mode: args.mode, requestedValue: args.value, before: before, after: after });
        });
    }

    function pluginsList(args) {
        var bounds = pagination(args);
        var root = selectedRoot(args);
        var known = admittedObject(root, args.objectId);
        var manager = root.access.mPluginManager;
        var collection = args.collection === undefined ? 0 : args.collection;
        var count = hostCount(invoke(manager, 'getNumberOfPluginCollections', [activeMapping, args.objectId]));
        if (!integer(collection, 0, MAX_INTEGER) || collection >= count) {
            fail('INVALID_COLLECTION', 'The requested plug-in collection does not exist.', { collectionCount: count });
        }
        var data = invoke(manager, 'getPluginCollectionByIndex', [activeMapping, args.objectId, collection]);
        if (!data || !Array.isArray(data.mEntries)) fail('INVALID_HOST_DATA', 'Invalid plug-in collection.');
        var name = hostText(data.mName);
        var items = [];
        for (var index = bounds.offset; index < Math.min(data.mEntries.length, bounds.offset + bounds.limit); index++) {
            var entry = data.mEntries[index];
            if (!entry) fail('INVALID_HOST_DATA', 'Invalid plug-in entry.');
            var item = { pluginUid: hostText(entry.mPluginUID), name: hostText(entry.mPluginName),
                vendor: hostText(entry.mPluginVendor), version: hostText(entry.mPluginVersion),
                formatVersion: hostText(entry.mFormatVersion), subCategories: hostText(entry.mSubCategories),
                collectionPath: hostText(entry.mCollectionPath) };
            if (!known.plugins[item.pluginUid]) {
                if (root.pluginCount >= MAX_PLUGINS) fail('OBSERVATION_LIMIT', 'Plug-in tracking limit reached for this root.');
                known.plugins[item.pluginUid] = true;
                root.pluginCount++;
            }
            items.push(item);
        }
        var result = pageResult(args, bounds, data.mEntries.length, items);
        result.objectId = args.objectId;
        result.collection = collection;
        result.collectionName = name;
        result.collectionCount = count;
        result.defaultCollection = invoke(manager, 'getIndexOfDefaultPluginCollection', [activeMapping, args.objectId]);
        result.activeCollection = invoke(manager, 'getIndexOfActivePluginCollection', [activeMapping, args.objectId]);
        if (!integer(result.defaultCollection, -1, count - 1) || !integer(result.activeCollection, -1, count - 1)) {
            fail('INVALID_HOST_DATA', 'Invalid active or default collection index.');
        }
        return result;
    }

    function pluginsSet(request, args) {
        if (args.confirmReplacement !== true) fail('CONFIRMATION_REQUIRED', 'confirmReplacement must be true.');
        var root = selectedRoot(args);
        var known = admittedObject(root, args.objectId);
        if (typeof args.pluginUid !== 'string' || !args.pluginUid.length || args.pluginUid.length > 4096 ||
            !known.plugins[args.pluginUid]) fail('PLUGIN_UNOBSERVED', 'List the plug-in UID for this slot before assigning it.');
        var manager = root.access.mPluginManager;
        var setter = method(manager, 'trySetSlotPlugin');
        return submitted(function () {
            var accepted = setter.call(manager, activeMapping, args.objectId, args.pluginUid, true);
            if (accepted !== true) {
                if (accepted !== false) fail('INVALID_HOST_DATA', 'trySetSlotPlugin did not return a boolean.');
                fail('PLUGIN_REJECTED', 'Cubase rejected the plug-in assignment.', { accepted: false });
            }
            clearRoot(root);
            return receipt(request, { root: args.root, objectId: args.objectId, pluginUid: args.pluginUid, accepted: true });
        });
    }

    function admitControlFeedback(record) {
        if (record.key.indexOf('track.') !== 0) return true;
        try {
            selectedTrack();
            return true;
        } catch (error) {
            clearTrackObservation();
            observedTrackId = null;
            return false;
        }
    }

    function surface(record) {
        record.surface = invoke(driver.mSurface, 'makeCustomValueVariable', [record.key]);
        method(record.surface, 'setProcessValue');
        record.surface.mOnProcessValueChange = function (device, value) {
            if (device === activeDevice && activeMapping && !writingSurface && finite(value) && value >= 0 && value <= 1 &&
                admitControlFeedback(record)) {
                record.observed = { value: value, revision: ++record.revision };
            }
        };
    }

    function makeControl(key, path, hostValue, momentary, readOnly) {
        var record = { key: key, path: path, momentary: !!momentary, readOnly: !!readOnly,
            observed: null, display: null, revision: 0, error: null, feedbackErrors: Object.create(null) };
        controls[key] = record;
        try {
            if (!hostValue) fail('API_UNAVAILABLE', 'Host value is missing: ' + path);
            surface(record);
            record.binding = invoke(page, 'makeValueBinding', [record.surface, hostValue]);
            if (!record.binding) fail('API_UNAVAILABLE', 'Value binding was not created for ' + key);
            hostValue.mOnProcessValueChange = function (device, mapping, value) {
                if (device === activeDevice && mapping === activeMapping && finite(value) && value >= 0 && value <= 1 &&
                    admitControlFeedback(record)) {
                    record.observed = { value: value, revision: ++record.revision };
                }
            };
            try {
                hostValue.mOnDisplayValueChange = function (device, mapping, value, units) {
                    if (device === activeDevice && mapping === activeMapping &&
                        typeof value === 'string' && typeof units === 'string' && admitControlFeedback(record)) {
                        record.display = { value: value, units: units };
                    }
                };
            } catch (error) { record.feedbackErrors.display = errorData(error); }
        } catch (error) {
            record.error = errorData(error);
        }
    }

    function makeQuickControls(prefix, path, collection) {
        for (var index = 0; index < 8; index++) {
            var value = null;
            var failure = null;
            try {
                var count = hostCount(invoke(collection, 'getSize', []));
                if (index >= count) fail('API_UNAVAILABLE', 'Quick-control index is not exposed by Cubase: ' + index);
                value = invoke(collection, 'getByIndex', [index]);
            } catch (error) {
                failure = errorData(error);
            }
            makeControl(prefix + index, path + '.getByIndex(' + index + ')', value, false);
            if (failure) controls[prefix + index].error = failure;
        }
    }

    function makeHostFields(prefix, path, hostObject, fields, readOnly) {
        fields.forEach(function (field) {
            var key = prefix + field[0];
            var fullPath = path + '.' + field[1];
            var hostValue;
            try {
                hostValue = hostObject && hostObject[field[1]];
                makeControl(key, fullPath, hostValue, false, readOnly);
            } catch (error) {
                makeControl(key, fullPath, null, false, readOnly);
                controls[key].error = errorData(error);
            }
        });
    }

    function hostBranch(parent, field, groupName) {
        try {
            if (!parent) fail('API_UNAVAILABLE', 'Required host branch is missing: ' + field);
            var branch = parent[field];
            if (!branch) fail('API_UNAVAILABLE', 'Required host branch is missing: ' + field);
            controlGroups[groupName] = { available: true };
            return branch;
        } catch (error) {
            controlGroups[groupName] = { available: false, error: errorData(error) };
            return null;
        }
    }

    function makeSendControls(channel, field, groupName, fields) {
        var group = { available: false, count: null };
        controlGroups[groupName] = group;
        try {
            var sends = channel && channel[field];
            var count = hostCount(invoke(sends, 'getSize', []));
            if (count > 32) fail('HOST_LIMIT_EXCEEDED', 'The send slot count exceeds the supported limit.', { count: count });
            method(sends, 'getByIndex');
            group.available = true;
            group.count = count;
            for (var index = 0; index < count; index++) {
                var slot;
                var slotError;
                try { slot = invoke(sends, 'getByIndex', [index]); }
                catch (error) { slotError = errorData(error); }
                var prefix = groupName + '.' + index + '.';
                makeHostFields(prefix, 'mHostAccess.mTrackSelection.mMixerChannel.' + field + '.getByIndex(' + index + ')',
                    slot, fields);
                if (slotError) {
                    fields.forEach(function (item) { controls[prefix + item[0]].error = slotError; });
                }
            }
            return sends;
        } catch (error) {
            group.error = errorData(error);
            return null;
        }
    }

    function makeControlRoomChannels(room, groupName, countMethod, getMethod, fields, budget) {
        var group = { available: false, count: null };
        controlGroups[groupName] = group;
        try {
            var count = hostCount(invoke(room, countMethod, []));
            group.count = count;
            if (count > budget.remaining) fail('HOST_LIMIT_EXCEEDED', 'Control Room channel maxima exceed the bridge binding budget.', { count: count, remaining: budget.remaining });
            method(room, getMethod);
            budget.remaining -= count;
            group.available = true;
            for (var index = 0; index < count; index++) {
                var object = null;
                var failure = null;
                try { object = invoke(room, getMethod, [index]); }
                catch (error) { failure = errorData(error); }
                var prefix = groupName + '.' + index + '.';
                makeHostFields(prefix, 'mHostAccess.mControlRoom.' + getMethod + '(' + index + ')', object, fields);
                if (failure) fields.forEach(function (field) { controls[prefix + field[0]].error = failure; });
            }
        } catch (error) { group.error = errorData(error); }
    }

    function controlInfo(record) {
        var result = { key: record.key, path: record.path, momentary: record.momentary,
            readOnly: record.readOnly, available: !record.error && !!activeMapping,
            observed: record.observed, display: record.display };
        if (record.error) result.error = record.error;
        if (Object.keys(record.feedbackErrors).length) result.feedbackErrors = record.feedbackErrors;
        return result;
    }

    function controlList() {
        if (activeMapping) {
            try {
                var current = selectedTrack();
                controlGroups['track.identity'] = { available: true, uniqueId: current.uniqueId };
            } catch (error) {
                clearTrackObservation();
                observedTrackId = null;
                controlGroups['track.identity'] = { available: false, error: errorData(error) };
            }
        }
        return Object.keys(controls).map(function (key) { return controlInfo(controls[key]); });
    }

    function controlsGet(args) {
        if (typeof args.key !== 'string' || !controls[args.key]) fail('INVALID_CONTROL', 'Unknown control key.');
        if (args.key.indexOf('track.') === 0) selectedTrack();
        return { session: session, control: controlInfo(controls[args.key]) };
    }

    function commandList() {
        return commandDefinitions.map(function (definition) {
            var record = commands[definition.key];
            var result = { key: definition.key, category: definition.category, name: definition.name,
                context: definition.context, available: !record.error && !!activeMapping, canPerform: false };
            if (record.error) result.error = record.error;
            else if (activeMapping) {
                try {
                    result.canPerform = hostBool(invoke(record.binding, 'canPerform', [activeMapping]));
                } catch (error) {
                    result.available = false;
                    result.error = errorData(error);
                }
            }
            return result;
        });
    }

    function setSurface(record, value, pulse) {
        var setter = method(record.surface, 'setProcessValue');
        writingSurface++;
        try {
            setter.call(record.surface, activeDevice, value);
            if (pulse && value > 0) setter.call(record.surface, activeDevice, 0);
        } finally {
            writingSurface--;
        }
    }

    function controlsSet(request, args) {
        if (typeof args.key !== 'string' || !controls[args.key]) fail('INVALID_CONTROL', 'Unknown control key.');
        var record = controls[args.key];
        if (record.error) fail(record.error.code, record.error.message, record.error.details);
        if (record.readOnly) fail('READ_ONLY', 'This control only exposes host feedback.');
        var currentTrack = args.key.indexOf('track.') === 0 ? selectedTrack() : null;
        if (args.expectedTrackUniqueId !== undefined) {
            if (!currentTrack || typeof args.expectedTrackUniqueId !== 'string' || !args.expectedTrackUniqueId) {
                fail('INVALID_ARGUMENT', 'expectedTrackUniqueId is only valid for a track control.');
            }
            if (currentTrack.uniqueId !== args.expectedTrackUniqueId) {
                fail('TRACK_CHANGED', 'The selected channel changed before the control write.',
                    { currentUniqueId: currentTrack.uniqueId });
            }
        }
        var value = normalized(args.value);
        method(record.surface, 'setProcessValue');
        var before = record.observed;
        return submitted(function () {
            setSurface(record, value, record.momentary);
            return receipt(request, { key: args.key, requestedValue: value, before: before, after: record.observed });
        });
    }

    function commandsExecute(request, args) {
        if (typeof args.key !== 'string' || !commands[args.key]) fail('COMMAND_NOT_ALLOWED', 'Command is not in the fixed background-only allowlist.');
        if (args.confirmCurrentSelection !== true) fail('CONFIRMATION_REQUIRED', 'confirmCurrentSelection must be true.');
        var record = commands[args.key];
        if (record.error) fail(record.error.code, record.error.message, record.error.details);
        method(record.surface, 'setProcessValue');
        if (!hostBool(invoke(record.binding, 'canPerform', [activeMapping]))) {
            fail('COMMAND_UNAVAILABLE', 'The command cannot perform in the current Cubase context.');
        }
        return submitted(function () {
            setSurface(record, 1, true);
            return receipt(request, { key: args.key, context: record.definition.context });
        });
    }

    function clearTrackObservation() {
        Object.keys(controls).forEach(function (key) {
            if (key.indexOf('track.') === 0) {
                controls[key].observed = null;
                controls[key].display = null;
            }
        });
    }

    function selectedTrack() {
        var selection = host && host.mTrackSelection;
        var selected = selection && selection.mMixerChannel;
        var uniqueId = hostText(invoke(selected, 'getUniqueIDString', [activeMapping]));
        if (!uniqueId) fail('NO_TRACK_SELECTED', 'Cubase did not report an identity for the selected channel.');
        if (observedTrackId !== null && observedTrackId !== uniqueId) clearTrackObservation();
        observedTrackId = uniqueId;
        return { session: session, uniqueId: uniqueId,
            runtimeId: hostCount(invoke(selected, 'getRuntimeID', [activeMapping])) };
    }

    function navigateTrack(request, args) {
        if (args.direction !== 'previous' && args.direction !== 'next') {
            fail('INVALID_ARGUMENT', 'direction must be previous or next.');
        }
        if (typeof args.expectedUniqueId !== 'string' || !args.expectedUniqueId) {
            fail('INVALID_ARGUMENT', 'expectedUniqueId must be the observed selected channel identity.');
        }
        var before = selectedTrack();
        if (before.uniqueId !== args.expectedUniqueId) {
            fail('TRACK_CHANGED', 'The selected channel changed; query it again before navigating.',
                { currentUniqueId: before.uniqueId });
        }
        var actions = host.mTrackSelection && host.mTrackSelection.mAction;
        var action = actions && actions[args.direction === 'previous' ? 'mPrevTrack' : 'mNextTrack'];
        var trigger = method(action, 'trigger');
        return submitted(function () {
            clearTrackObservation();
            trigger.call(action, activeMapping);
            return receipt(request, { direction: args.direction, before: before });
        });
    }

    function timeDisplay() {
        return host && host.mTransport && host.mTransport.mTimeDisplay;
    }

    function timeTarget(args) {
        if (args.display !== 'primary' && args.display !== 'secondary') {
            fail('INVALID_ARGUMENT', 'display must be primary or secondary.');
        }
        var locators = { cursor: 'mTransportLocator', cycleLeft: 'mCycleLocatorLeft', cycleRight: 'mCycleLocatorRight' };
        if (typeof args.locator !== 'string' || !Object.prototype.hasOwnProperty.call(locators, args.locator)) {
            fail('INVALID_ARGUMENT', 'locator must be cursor, cycleLeft, or cycleRight.');
        }
        var display = timeDisplay();
        var detail = display && display[args.display === 'primary' ? 'mPrimary' : 'mSecondary'];
        return detail && detail[locators[args.locator]];
    }

    function clearTransportObservation() {
        transportObservation = { tempo: null,
            primary: { cursor: null, cycleLeft: null, cycleRight: null },
            secondary: { cursor: null, cycleLeft: null, cycleRight: null } };
    }

    function setupTransportObservation() {
        var display = timeDisplay();
        try {
            if (!display) fail('API_UNAVAILABLE', 'Transport time display is unavailable.');
            display.mOnChangeTempoBPM = function (device, mapping, bpm) {
                if (device === activeDevice && mapping === activeMapping && finite(bpm) && bpm > 0) {
                    transportObservation.tempo = { bpm: bpm };
                }
            };
        } catch (error) { transportObservationErrors.tempo = errorData(error); }
        ['primary', 'secondary'].forEach(function (displayName) {
            ['cursor', 'cycleLeft', 'cycleRight'].forEach(function (locator) {
                var key = displayName + '.' + locator;
                try {
                    var target = timeTarget({ display: displayName, locator: locator });
                    if (!target) fail('API_UNAVAILABLE', 'Transport time locator is unavailable: ' + key);
                    target.mOnChange = function (device, mapping, time, format) {
                        if (device === activeDevice && mapping === activeMapping &&
                            typeof time === 'string' && typeof format === 'string') {
                            transportObservation[displayName][locator] = { time: time, format: format };
                        }
                    };
                } catch (error) { transportObservationErrors[key] = errorData(error); }
            });
        });
    }

    function transportGet() {
        return { session: session, observed: transportObservation, errors: transportObservationErrors };
    }

    function transportTempo(request, args) {
        if (!finite(args.bpm) || args.bpm <= 0) {
            fail('INVALID_VALUE', 'bpm must be a finite positive number.');
        }
        var display = timeDisplay();
        var setter = method(display, 'setTempoBPM');
        return submitted(function () {
            setter.call(display, activeMapping, args.bpm);
            return receipt(request, { requestedBpm: args.bpm });
        });
    }

    function transportTime(request, args) {
        if (typeof args.time !== 'string' || !args.time.length || args.time.length > 64 || /^\s*$/.test(args.time)) {
            fail('INVALID_VALUE', 'time must be a nonempty string of at most 64 characters.');
        }
        var target = timeTarget(args);
        var setter = method(target, 'setTime');
        return submitted(function () {
            setter.call(target, activeMapping, args.time);
            return receipt(request, { display: args.display, locator: args.locator, requestedTime: args.time });
        });
    }

    function timeFeatures() {
        var display = timeDisplay();
        var result = { tempo: !!display && typeof display.setTempoBPM === 'function', time: {} };
        ['primary', 'secondary'].forEach(function (name) {
            result.time[name] = {};
            ['cursor', 'cycleLeft', 'cycleRight'].forEach(function (locator) {
                var target = timeTarget({ display: name, locator: locator });
                result.time[name][locator] = !!target && typeof target.setTime === 'function';
            });
        });
        return result;
    }

    function status() {
        var appVersion = version();
        var transportFeatures = timeFeatures();
        var descriptions = rootNames.map(function (key) {
            var root = roots[key];
            var result = { key: key, path: 'mHostAccess.' + root.path, available: false };
            try {
                refresh(root);
                result.object = observeObject(root, root.base);
                result.baseObjectId = root.base;
                result.available = true;
            } catch (error) {
                result.error = errorData(error);
                result.error.details = { stage: root.stage, stack: error.stack ? String(error.stack) : null };
            }
            return result;
        });
        return { session: session, appVersion: appVersion, bridgeRevision: BRIDGE_REVISION, active: !!activeMapping,
            policy: { backgroundOnly: true, fallback: false },
            features: { directAccess: !!host && typeof host.makeDirectAccess === 'function',
                valueBindings: typeof page.makeValueBinding === 'function',
                commandBindings: typeof page.makeCommandBinding === 'function',
                tempo: transportFeatures.tempo, time: transportFeatures.time,
                roots: descriptions.map(function (description) { return { key: description.key, available: description.available }; }) },
            roots: descriptions, controls: controlList(), controlGroups: controlGroups,
            transportObservation: transportObservation, commands: commandList(),
            limits: { requests: MAX_REQUESTS, trackedIds: MAX_IDS, outputFrames: MAX_FRAMES,
                framesPerIdle: FRAMES_PER_IDLE, objectsPerRoot: MAX_OBJECTS, tagsPerRoot: MAX_TAGS, pluginsPerRoot: MAX_PLUGINS },
            diagnostics: { malformedFrames: malformedFrames, droppedResponses: droppedResponses, transportError: transportError } };
    }

    function dispatch(request) {
        if (!request || request.v !== 1 || typeof request.op !== 'string' || !request.args ||
            typeof request.args !== 'object' || Array.isArray(request.args)) fail('INVALID_REQUEST', 'Expected {v:1,id,op,args}.');
        if (!finite(request.deadline)) fail('INVALID_REQUEST', 'A finite epoch deadline is required.', undefined, 'not_started');
        if (request.deadline <= Date.now()) fail('REQUEST_EXPIRED', 'Request expired before execution.', undefined, 'not_started');
        if (request.op === 'bridge.status') return status();
        version();
        if (!activeMapping || !session || request.args.session !== session) fail('STALE_SESSION', 'Use the active session from bridge.status.');
        method(host, 'makeDirectAccess');
        var args = request.args;
        if (request.op === 'objects.list') return objectsList(args);
        if (request.op === 'host.info') return hostInfo();
        if (request.op === 'objects.get') return objectsGet(args);
        if (request.op === 'mixer.channel') return mixerChannelInfo(args);
        if (request.op === 'parameters.list') return parametersList(args);
        if (request.op === 'parameters.get') return parametersGet(args);
        if (request.op === 'parameters.set') return parametersSet(request, args);
        if (request.op === 'plugins.list') return pluginsList(args);
        if (request.op === 'plugins.set') return pluginsSet(request, args);
        if (request.op === 'controls.list') return { session: session, controls: controlList(), groups: controlGroups };
        if (request.op === 'controls.get') return controlsGet(args);
        if (request.op === 'controls.set') return controlsSet(request, args);
        if (request.op === 'commands.list') return { session: session, commands: commandList() };
        if (request.op === 'commands.execute') return commandsExecute(request, args);
        if (request.op === 'track.current') return selectedTrack();
        if (request.op === 'track.navigate') return navigateTrack(request, args);
        if (request.op === 'transport.get') return transportGet();
        if (request.op === 'transport.tempo') return transportTempo(request, args);
        if (request.op === 'transport.time') return transportTime(request, args);
        fail('UNKNOWN_OPERATION', 'Unsupported bridge operation: ' + request.op);
    }

    function enqueueResponse(response) {
        var frames;
        try {
            frames = protocol.encode(response);
        } catch (error) {
            var execution = response.ok && response.data ? response.data.execution : response.error && response.error.execution;
            frames = protocol.encode({ v: 1, id: response.id, ok: false,
                error: { code: 'RESPONSE_TOO_LARGE', message: 'Response cannot be encoded; request a smaller page.',
                    execution: execution } });
        }
        if (outbound.length + frames.length > MAX_FRAMES) {
            droppedResponses++;
            return;
        }
        for (var index = 0; index < frames.length; index++) outbound.push(frames[index]);
    }

    function rejection(id, code, message) {
        enqueueResponse({ v: 1, id: id, ok: false, error: { code: code, message: message } });
    }

    input.mOnSysex = function (device, bytes) {
        if (device !== activeDevice) return;
        var request;
        try {
            request = decoder.accept(bytes, Date.now());
        } catch (error) {
            malformedFrames++;
            return;
        }
        if (!request) return;
        if (seen[request.id]) return rejection(request.id, 'DUPLICATE_ID', 'This request ID was already admitted; it will not be executed again.');
        if (seenCount >= MAX_IDS) return rejection(request.id, 'REQUEST_LIMIT', 'Request ID tracking is full; reactivate the mapping page.');
        seen[request.id] = true;
        seenCount++;
        if (pending.length >= MAX_REQUESTS) return rejection(request.id, 'QUEUE_FULL', 'The request queue is full; this request was not executed.');
        pending.push(request);
    };

    page.mOnActivate = function (device, mapping) {
        activeDevice = device;
        activeMapping = mapping;
        session = instance + '-' + (++generation);
        decoder.reset();
        pending = [];
        outbound = [];
        seen = Object.create(null);
        seenCount = 0;
        observedTrackId = null;
        clearTransportObservation();
        Object.keys(controls).forEach(function (key) {
            controls[key].observed = null; controls[key].display = null; controls[key].revision = 0;
        });
        rootNames.forEach(function (key) {
            var root = roots[key];
            clearRoot(root);
            root.active = false;
            if (root.error) return;
            try {
                version();
                root.stage = 'activate';
                invoke(root.access, 'activate', [mapping]);
                root.active = true;
                root.stage = 'ready';
            } catch (error) {
                root.error = errorData(error);
                root.error.details = { stage: root.stage, stack: error.stack ? String(error.stack) : null };
            }
        });
    };

    page.mOnDeactivate = function (device, mapping) {
        if (device !== activeDevice || mapping !== activeMapping) return;
        rootNames.forEach(function (key) {
            var root = roots[key];
            if (root.active) {
                try { invoke(root.access, 'deactivate', [mapping]); }
                catch (error) { root.error = errorData(error); }
            }
            root.active = false;
            clearRoot(root);
        });
        session = null;
        activeMapping = null;
        pending = [];
        outbound = [];
        decoder.reset();
        observedTrackId = null;
        clearTransportObservation();
        Object.keys(controls).forEach(function (key) { controls[key].observed = null; controls[key].display = null; });
    };

    page.mOnIdle = function (device, mapping) {
        if (device !== activeDevice || mapping !== activeMapping || inIdle) return;
        inIdle = true;
        try {
            if (pending.length && outbound.length <= MAX_FRAMES - FRAME_RESERVE) {
                var request = pending.shift();
                var response;
                try { response = { v: 1, id: request.id, ok: true, data: dispatch(request) }; }
                catch (error) { response = { v: 1, id: request.id, ok: false, error: errorData(error) }; }
                enqueueResponse(response);
            }
            for (var index = 0; index < FRAMES_PER_IDLE && outbound.length; index++) {
                var frame = outbound.shift();
                try { output.sendMidi(device, frame); }
                catch (error) { transportError = String(error.message || error); outbound = []; break; }
            }
        } finally {
            inIdle = false;
        }
    };

    rootNames.forEach(function (key, index) { makeRoot(key, rootPaths[index]); });
    var transport = host && host.mTransport && host.mTransport.mValue;
    var transportNames = ['start', 'stop', 'record', 'rewind', 'forward', 'cycle', 'metronome'];
    var transportValues = ['mStart', 'mStop', 'mRecord', 'mRewind', 'mForward', 'mCycleActive', 'mMetronomeActive'];
    transportNames.forEach(function (name, index) {
        makeControl('transport.' + name, 'mHostAccess.mTransport.mValue.' + transportValues[index],
            transport && transport[transportValues[index]], index < 3);
    });
    makeHostFields('transport.', 'mHostAccess.mTransport.mValue', transport,
        [['metronomeLevel', 'mMetronomeClickLevel']]);
    var channel = host && host.mTrackSelection && host.mTrackSelection.mMixerChannel;
    var channelValues = channel && channel.mValue;
    ['volume', 'pan', 'mute', 'solo', 'recordEnable', 'monitorEnable', 'automationRead', 'automationWrite'].forEach(function (name) {
        var field = 'm' + name.charAt(0).toUpperCase() + name.slice(1);
        makeControl('track.' + name, 'mHostAccess.mTrackSelection.mMixerChannel.mValue.' + field,
            channelValues && channelValues[field], false);
    });
    makeHostFields('track.meter.', 'mHostAccess.mTrackSelection.mMixerChannel.mValue', channelValues,
        [['level', 'mVUMeter'], ['maximum', 'mVUMeterMax'], ['clip', 'mVUMeterClip'], ['peak', 'mVUMeterPeak']], true);
    var filter = hostBranch(channel, 'mPreFilter', 'track.filter');
    makeHostFields('track.filter.', 'mHostAccess.mTrackSelection.mMixerChannel.mPreFilter', filter,
        [['bypass', 'mBypass'], ['gain', 'mGain'], ['phase', 'mPhaseSwitch'],
         ['highCutOn', 'mHighCutOn'], ['highCutFrequency', 'mHighCutFreq'], ['highCutSlope', 'mHighCutSlope'],
         ['lowCutOn', 'mLowCutOn'], ['lowCutFrequency', 'mLowCutFreq'], ['lowCutSlope', 'mLowCutSlope']]);
    var equalizer = hostBranch(channel, 'mChannelEQ', 'track.eq');
    for (var bandIndex = 1; bandIndex <= 4; bandIndex++) {
        var bandField = 'mBand' + bandIndex;
        makeHostFields('track.eq.' + bandIndex + '.', 'mHostAccess.mTrackSelection.mMixerChannel.mChannelEQ.' + bandField,
            hostBranch(equalizer, bandField, 'track.eq.' + bandIndex),
            [['gain', 'mGain'], ['frequency', 'mFreq'], ['q', 'mQ'], ['on', 'mOn'], ['filterType', 'mFilterType']]);
    }
    makeSendControls(channel, 'mSends', 'track.send', [['on', 'mOn'], ['prePost', 'mPrePost'], ['level', 'mLevel']]);
    var cueSends = makeSendControls(channel, 'mCueSends', 'track.cueSend',
        [['on', 'mOn'], ['prePost', 'mPrePost'], ['level', 'mLevel'], ['pan', 'mPan']]);
    makeHostFields('track.cueSend.', 'mHostAccess.mTrackSelection.mMixerChannel.mCueSends', cueSends,
        [['bypass', 'mBypass']]);
    makeHostFields('track.instrument.', 'mHostAccess.mTrackSelection.mMixerChannel.mInstrumentPluginSlot',
        hostBranch(channel, 'mInstrumentPluginSlot', 'track.instrument'),
        [['on', 'mOn'], ['bypass', 'mBypass'], ['automationRead', 'mAutomationRead'], ['automationWrite', 'mAutomationWrite']]);
    var effects = hostBranch(channel, 'mInsertAndStripEffects', 'track.effects');
    var strip = hostBranch(effects, 'mStripEffects', 'track.strip');
    [['gate', 'mGate'], ['compressor', 'mCompressor'], ['limiter', 'mLimiter'],
        ['saturator', 'mSaturator'], ['tools', 'mTools']].forEach(function (entry) {
        var group = 'track.strip.' + entry[0];
        makeHostFields(group + '.', 'mHostAccess.mTrackSelection.mMixerChannel.mInsertAndStripEffects.mStripEffects.' + entry[1],
            hostBranch(strip, entry[1], group),
            [['on', 'mOn'], ['bypass', 'mBypass'], ['automationRead', 'mAutomationRead'], ['automationWrite', 'mAutomationWrite']]);
    });
    clearTransportObservation();
    setupTransportObservation();
    makeQuickControls('track.quick.', 'mHostAccess.mTrackSelection.mMixerChannel.mQuickControls', channel && channel.mQuickControls);
    makeQuickControls('focus.quick.', 'mHostAccess.mFocusedQuickControls', host && host.mFocusedQuickControls);
    makeHostFields('focus.', 'mHostAccess.mFocusedQuickControls', host && host.mFocusedQuickControls,
        [['lock', 'mFocusLockedValue']]);
    var room = hostBranch(host, 'mControlRoom', 'controlRoom');
    makeHostFields('controlRoom.', 'mHostAccess.mControlRoom', room,
        [['alertDimActive', 'mAlertDimActiveValue'], ['talkbackActive', 'mTalkbackActiveValue'],
         ['talkbackDimLevel', 'mTalkbackDimLevelValue'], ['listenDimLevel', 'mListenDimLevelValue'],
         ['referenceLevel', 'mReferenceLevelValue']]);
    var roomMainFields = [['level', 'mLevelValue'], ['mute', 'mMuteValue'], ['bypassInserts', 'mBypassInserts'],
        ['sourceMonitorMix', 'mSelectSourceMonitorMixValue'], ['sourceExternalInput', 'mSelectSourceExternalInputValue'],
        ['listenEnabled', 'mListenEnabledValue'], ['listenLevel', 'mListenLevelValue'], ['dimActive', 'mDimActiveValue'],
        ['metronomeActive', 'mMetronomeClickActiveValue'], ['metronomeLevel', 'mMetronomeClickLevelValue'],
        ['metronomePan', 'mMetronomeClickPanValue']];
    var main = hostBranch(room, 'mMainChannel', 'controlRoom.main');
    makeHostFields('controlRoom.main.', 'mHostAccess.mControlRoom.mMainChannel', main,
        roomMainFields.concat([['referenceLevelEnabled', 'mReferenceLevelEnabledValue']]));
    var basicRoomFields = roomMainFields.slice(0, 3);
    var cueFields = basicRoomFields.concat([['sourceMonitorMix', 'mSelectSourceMonitorMixValue'],
        ['sourceExternalInput', 'mSelectSourceExternalInputValue'], ['sourceAux', 'mSelectSourceAuxValue'],
        ['talkbackEnabled', 'mTalkbackEnabledValue'], ['talkbackLevel', 'mTalkbackLevelValue'],
        ['metronomeActive', 'mMetronomeClickActiveValue'], ['metronomeLevel', 'mMetronomeClickLevelValue'],
        ['metronomePan', 'mMetronomeClickPanValue']]);
    var roomBudget = { remaining: 16 };
    makeControlRoomChannels(room, 'controlRoom.cue', 'getMaxCueChannels', 'getCueChannelByIndex', cueFields, roomBudget);
    makeControlRoomChannels(room, 'controlRoom.phones', 'getMaxPhonesChannels', 'getPhonesChannelByIndex', roomMainFields, roomBudget);
    makeControlRoomChannels(room, 'controlRoom.externalInput', 'getMaxExternalInputChannels', 'getExternalInputChannelByIndex', basicRoomFields, roomBudget);
    makeControlRoomChannels(room, 'controlRoom.talkback', 'getMaxTalkbackChannels', 'getTalkbackChannelByIndex', basicRoomFields, roomBudget);
    makeControlRoomChannels(room, 'controlRoom.monitor', 'getMaxMonitorChannels', 'getMonitorChannelByIndex', basicRoomFields, roomBudget);
    commandDefinitions.forEach(function (definition) {
        var record = { key: 'command.' + definition.key, definition: definition, error: null, revision: 0 };
        commands[definition.key] = record;
        try {
            surface(record);
            record.binding = invoke(page, 'makeCommandBinding', [record.surface, definition.category, definition.name]);
            record.binding = invoke(record.binding, 'filterByValue', [1]);
            method(record.binding, 'canPerform');
        } catch (error) {
            record.error = errorData(error);
        }
    });
    return { deviceDriver: driver, page: page, midiInput: input, midiOutput: output };
}

module.exports = { createController: createController };
