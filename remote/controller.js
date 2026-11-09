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
var BRIDGE_REVISION = '2026-11-10-coverage-3.10';

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
    var message = String(error.message || error);
    var result = { code: error.code || 'HOST_ERROR', message: message.slice(0, 512) };
    if (message.length > 512) result.messageTruncated = true;
    if (error.details !== undefined) result.details = boundedMetadata(error.details, 0);
    if (error.execution !== undefined) result.execution = error.execution;
    return result;
}

function identityField(key) {
    return /^(?:id|session|root|key|uniqueName|uniqueIdString)$/.test(key || '') ||
        /(?:Id|ID|Uid|UID)$/.test(key || '');
}

function boundedMetadata(value, depth, field) {
    if (typeof value === 'string') return identityField(field) || value.length <= 128 ? value : value.slice(0, 128) + '…';
    if (value === null || typeof value !== 'object') return value;
    if (depth >= 4) return '[metadata depth limit]';
    if (Array.isArray(value)) return value.slice(0, 16).map(function (item) { return boundedMetadata(item, depth + 1, field); });
    var result = {};
    Object.keys(value).slice(0, 16).forEach(function (key) {
        result[identityField(key) ? key : key.slice(0, 128)] = boundedMetadata(value[key], depth + 1, key);
    });
    if (Object.keys(value).length > 16) result.metadataTruncated = true;
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

function createController(api, logger) {
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
    var bankSlots = [];
    var transportObservation;
    var transportObservationErrors = Object.create(null);
    var observedTrackId = null;
    var observedTrackRuntimeId = null;
    var commands = Object.create(null);
    var inIdle = false;
    var writingSurface = 0;
    var malformedFrames = 0;
    var droppedResponses = 0;
    var transportError = null;
    var loggedInput = false;
    var loggedDecoded = false;
    var loggedIdle = false;
    var loggedOutput = false;

    function trace(stage) {
        if (logger && typeof logger.log === 'function') logger.log('[CubaseAI MCP] ' + stage);
    }

    driver.mOnActivate = function () { trace('device activated'); };
    driver.mOnDeactivate = function () { trace('device deactivated'); };

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

    function parametersSetEditLock(request, args) {
        if (typeof args.locked !== 'boolean' || typeof args.expectedLocked !== 'boolean') {
            fail('INVALID_ARGUMENT', 'locked and expectedLocked must be booleans.');
        }
        var operationMapping = activeMapping, operationSession = session;
        var root = selectedRoot(args);
        var known = admittedParameter(root, args.objectId, args.tag);
        var index = known.tags[args.tag];
        var setter = method(root.access, 'setParameterEditLockState');
        var before = hostBool(invoke(root.access, 'getParameterEditLockState', [operationMapping, args.objectId, args.tag]));
        if (before !== args.expectedLocked) {
            fail('LOCK_STATE_CONFLICT', 'The observed edit lock differs from expectedLocked.', { actualLocked: before });
        }
        if (activeMapping !== operationMapping || session !== operationSession) {
            fail('STALE_SESSION', 'The active mapping changed before the edit-lock write.');
        }
        if (root.objects[args.objectId] !== known || known.tags[args.tag] !== index) {
            fail('PARAMETER_STALE', 'The observed parameter changed before the edit-lock write.');
        }
        return submitted(function () {
            setter.call(root.access, operationMapping, args.objectId, args.tag, args.locked);
            var result = receipt(request, { root: args.root, objectId: args.objectId, tag: args.tag,
                beforeLocked: before, requestedLocked: args.locked });
            result.session = operationSession;
            return result;
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
        if (record.bankIndex !== undefined) {
            try { bankChannelIdentity(record.bankIndex, false); return true; }
            catch (error) { markBankError(record.bankIndex, error); return false; }
        }
        if (record.key.indexOf('track.') !== 0) return true;
        try {
            selectedTrack();
            return true;
        } catch (error) {
            clearTrackObservation();
            observedTrackId = null;
            observedTrackRuntimeId = null;
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
                if (record.bankIndex !== undefined) record.observed.channelUniqueId = bankSlots[record.bankIndex].uniqueId;
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
                    if (record.bankIndex !== undefined) record.observed.channelUniqueId = bankSlots[record.bankIndex].uniqueId;
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

    function makeActionControl(key, path, action) {
        var record = { key: key, path: path, momentary: true, readOnly: false, action: true,
            observed: null, display: null, revision: 0, error: null, feedbackErrors: Object.create(null) };
        controls[key] = record;
        try {
            if (!action) fail('API_UNAVAILABLE', 'Host action is missing: ' + path);
            surface(record);
            var binding = invoke(page, 'makeActionBinding', [record.surface, action]);
            record.binding = invoke(binding, 'filterByValue', [1]);
            if (!record.binding) fail('API_UNAVAILABLE', 'Filtered action binding was not created: ' + key);
        } catch (error) { record.error = errorData(error); }
    }

    function makeQuickControls(prefix, path, collection, bankIndex) {
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
            if (bankIndex !== undefined) controls[prefix + index].bankIndex = bankIndex;
            if (failure) controls[prefix + index].error = failure;
        }
    }

    function makeHostFields(prefix, path, hostObject, fields, readOnly, bankIndex) {
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
            if (bankIndex !== undefined) controls[key].bankIndex = bankIndex;
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

    function makeSendControls(channel, field, groupName, fields, basePath, bankIndex) {
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
                makeHostFields(prefix, basePath + '.' + field + '.getByIndex(' + index + ')',
                    slot, fields, false, bankIndex);
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
        var slots = [];
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
                slots.push(object);
                var prefix = groupName + '.' + index + '.';
                makeHostFields(prefix, 'mHostAccess.mControlRoom.' + getMethod + '(' + index + ')', object, fields);
                if (failure) fields.forEach(function (field) { controls[prefix + field[0]].error = failure; });
            }
        } catch (error) { group.error = errorData(error); }
        return slots;
    }

    function makeIndexedRoomValues(parent, count, getter, groupName, path, budget) {
        var group = { available: false, count: count };
        controlGroups[groupName] = group;
        try {
            if (!integer(count, 0, MAX_INTEGER)) fail('API_UNAVAILABLE', 'Host maximum is unavailable for ' + groupName);
            if (count > budget.remaining) fail('HOST_LIMIT_EXCEEDED', 'Control Room selector maxima exceed the bridge binding budget.', { count: count, remaining: budget.remaining });
            method(parent, getter);
            budget.remaining -= count;
            group.available = true;
            for (var index = 0; index < count; index++) {
                var value = null;
                var error = null;
                try { value = invoke(parent, getter, [index]); }
                catch (exception) { error = errorData(exception); }
                var key = groupName + '.' + index;
                makeControl(key, path + '.' + getter + '(' + index + ')', value, false);
                if (error) controls[key].error = error;
            }
        } catch (exception) { group.error = errorData(exception); }
    }

    function controlInfo(record) {
        var result = { key: record.key, path: record.path, momentary: record.momentary,
            readOnly: record.readOnly, available: !record.error && !!activeMapping,
            observed: record.observed, display: record.display };
        if (record.bankIndex !== undefined) {
            var slot = bankSlots[record.bankIndex];
            result.channel = { index: record.bankIndex, uniqueId: slot.uniqueId, runtimeId: slot.runtimeId };
            if (!slot.uniqueId) {
                result.available = false;
                var group = controlGroups['mixer.channel.' + record.bankIndex];
                if (!record.error && group && group.error) result.error = group.error;
            }
        }
        if (record.error) result.error = record.error;
        if (Object.keys(record.feedbackErrors).length) result.feedbackErrors = record.feedbackErrors;
        return result;
    }

    function controlList(args) {
        if (activeMapping) {
            try {
                var current = selectedTrack();
                controlGroups['track.identity'] = { available: true, uniqueId: current.uniqueId, runtimeId: current.runtimeId };
            } catch (error) {
                clearTrackObservation();
                observedTrackId = null;
                observedTrackRuntimeId = null;
                controlGroups['track.identity'] = { available: false, error: errorData(error) };
            }
        }
        var offset = args.offset === undefined ? 0 : args.offset;
        var limit = args.limit === undefined ? 16 : args.limit;
        var groupOffset = args.groupOffset === undefined ? 0 : args.groupOffset;
        var groupLimit = args.groupLimit === undefined ? 16 : args.groupLimit;
        if (!integer(offset, 0, MAX_INTEGER) || !integer(groupOffset, 0, MAX_INTEGER) ||
            !integer(limit, 1, 16) || !integer(groupLimit, 1, 16)) {
            fail('INVALID_ARGUMENT', 'Offsets must be nonnegative and limits must be in [1, 16].');
        }
        var keys = Object.keys(controls), groupKeys = Object.keys(controlGroups), groups = {};
        keys.slice(offset, offset + limit).forEach(function (key) {
            if (controls[key].bankIndex !== undefined) {
                try { bankChannelIdentity(controls[key].bankIndex, true); } catch (error) { markBankError(controls[key].bankIndex, error); }
            }
        });
        groupKeys.slice(groupOffset, groupOffset + groupLimit).forEach(function (key) {
            var match = /^mixer\.channel\.(\d+)(?:\.|$)/.exec(key);
            if (match) { try { bankChannelIdentity(Number(match[1]), true); } catch (error) { markBankError(Number(match[1]), error); } }
        });
        var items = keys.slice(offset, offset + limit).map(function (key) { return boundedMetadata(controlInfo(controls[key]), 0); });
        groupKeys.slice(groupOffset, groupOffset + groupLimit).forEach(function (key) {
            groups[key] = boundedMetadata(controlGroups[key], 0);
            var match = /^mixer\.channel\.(\d+)\./.exec(key);
            if (match) {
                var index = Number(match[1]), slot = bankSlots[index], channelGroup = controlGroups['mixer.channel.' + index];
                groups[key].channel = { index: index, uniqueId: slot.uniqueId, runtimeId: slot.runtimeId };
                if (!slot.uniqueId) {
                    groups[key].available = false;
                    if (!groups[key].error && channelGroup && channelGroup.error) groups[key].error = boundedMetadata(channelGroup.error, 0);
                }
            }
        });
        var next = Math.min(keys.length, offset + items.length);
        var nextGroup = Math.min(groupKeys.length, groupOffset + Object.keys(groups).length);
        return { session: session, controls: items, groups: groups, offset: offset, limit: limit, total: keys.length,
            nextOffset: next < keys.length ? next : null, groupOffset: groupOffset, groupLimit: groupLimit,
            groupTotal: groupKeys.length, nextGroupOffset: nextGroup < groupKeys.length ? nextGroup : null };
    }

    function controlsGet(args) {
        if (typeof args.key !== 'string' || !controls[args.key]) fail('INVALID_CONTROL', 'Unknown control key.');
        if (args.key.indexOf('track.') === 0) selectedTrack();
        if (controls[args.key].bankIndex !== undefined) bankChannelIdentity(controls[args.key].bankIndex, true);
        var record = controls[args.key];
        var info = boundedMetadata(controlInfo(record), 0);
        if (record.pluginBankGroup) {
            var identity = controlGroups[record.pluginBankGroup].pluginIdentity;
            info.pluginIdentity = identity ? { name: identity.name, vendor: identity.vendor,
                version: identity.version, formatVersion: identity.formatVersion } : null;
        }
        return { session: session, control: info };
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
        if ((args.key.indexOf('track.insert.') === 0 || (record.pluginBankGroup && currentTrack)) && args.expectedTrackUniqueId === undefined) {
            fail('CONFIRMATION_REQUIRED', 'Track plug-in controls require expectedTrackUniqueId.');
        }
        if (args.expectedTrackUniqueId !== undefined) {
            if (!currentTrack || typeof args.expectedTrackUniqueId !== 'string' || !args.expectedTrackUniqueId) {
                fail('INVALID_ARGUMENT', 'expectedTrackUniqueId is only valid for a track control.');
            }
            if (currentTrack.uniqueId !== args.expectedTrackUniqueId) {
                fail('TRACK_CHANGED', 'The selected channel changed before the control write.',
                    { currentUniqueId: currentTrack.uniqueId });
            }
        }
        if (args.expectedTrackRuntimeId !== undefined) {
            if (!currentTrack || args.expectedTrackUniqueId === undefined ||
                !integer(args.expectedTrackRuntimeId, 0, MAX_INTEGER)) {
                fail('INVALID_ARGUMENT', 'expectedTrackRuntimeId requires a track control and expectedTrackUniqueId.');
            }
            if (currentTrack.runtimeId !== args.expectedTrackRuntimeId) {
                fail('TRACK_CHANGED', 'The selected channel instance changed before the control write.',
                    { currentUniqueId: currentTrack.uniqueId, currentRuntimeId: currentTrack.runtimeId });
            }
        }
        if (record.bankIndex !== undefined) {
            if (typeof args.expectedChannelUniqueId !== 'string' || !args.expectedChannelUniqueId) {
                fail('CONFIRMATION_REQUIRED', 'Bank-channel writes require the previously observed expectedChannelUniqueId.');
            }
            var slot = bankSlots[record.bankIndex];
            if (!slot || !slot.admitted || slot.uniqueId !== args.expectedChannelUniqueId) {
                fail('CHANNEL_UNOBSERVED', 'Read the current bank channel before writing.');
            }
            var currentChannel;
            try { currentChannel = bankChannelIdentity(record.bankIndex, false); }
            catch (error) { markBankError(record.bankIndex, error); throw error; }
            if (!slot.admitted || currentChannel.uniqueId !== args.expectedChannelUniqueId) {
                fail('CHANNEL_CHANGED', 'The bank channel changed before the control write.', { currentUniqueId: currentChannel.uniqueId });
            }
        } else if (args.expectedChannelUniqueId !== undefined) {
            fail('INVALID_ARGUMENT', 'expectedChannelUniqueId is only valid for a bank-channel control.');
        }
        if (record.pluginBankGroup) {
            var expectedPlugin = args.expectedPluginIdentity;
            if (!expectedPlugin || typeof expectedPlugin !== 'object' || Array.isArray(expectedPlugin))
                fail('CONFIRMATION_REQUIRED', 'expectedPluginIdentity is required.');
            var identity = controlGroups[record.pluginBankGroup].pluginIdentity;
            if (!identity || typeof identity.name !== 'string' || !identity.name ||
                (currentTrack && (identity.trackUniqueId !== currentTrack.uniqueId || identity.trackRuntimeId !== currentTrack.runtimeId)) ||
                (record.bankIndex !== undefined && (identity.channelUniqueId !== currentChannel.uniqueId || identity.channelRuntimeId !== currentChannel.runtimeId)))
                fail('PLUGIN_UNOBSERVED', 'Observe the current plug-in identity before writing.');
            if (['name', 'vendor', 'version', 'formatVersion'].some(function (field) {
                return typeof expectedPlugin[field] !== 'string' || expectedPlugin[field] !== identity[field];
            })) fail('PLUGIN_CHANGED', 'The plug-in identity changed before the control write.');
        } else if (args.expectedPluginIdentity !== undefined) {
            fail('INVALID_ARGUMENT', 'expectedPluginIdentity is only valid for a guarded plug-in bank control.');
        }
        var value = normalized(args.value);
        if (record.action && value !== 1) fail('INVALID_VALUE', 'Action controls require value 1.');
        method(record.surface, 'setProcessValue');
        var before = record.observed;
        return submitted(function () {
            if (record.action && record.pluginBankGroup) {
                clearGroupObservation(record.pluginBankGroup);
                controlGroups[record.pluginBankGroup].pluginIdentity = null;
            }
            if (record.action && args.key.indexOf('track.') === 0 && !record.pluginBankGroup) clearTrackObservation();
            if (record.action && args.key.indexOf('mixer.bank.') === 0) clearBankObservations();
            if (record.action && record.bankIndex !== undefined && args.key.indexOf('.insert.') !== -1) clearBankSlot(record.bankIndex);
            if (record.bankIndex !== undefined && /\.selected$/.test(args.key)) {
                clearTrackObservation();
                observedTrackId = null;
                observedTrackRuntimeId = null;
            }
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

    function clearGroupObservation(group) {
        Object.keys(controls).forEach(function (key) {
            if (key.indexOf(group + '.') === 0) {
                controls[key].observed = null;
                controls[key].display = null;
            }
        });
    }

    function clearTrackObservation() {
        Object.keys(controls).forEach(function (key) {
            if (key.indexOf('track.') === 0) {
                controls[key].observed = null;
                controls[key].display = null;
            }
        });
        Object.keys(controlGroups).forEach(function (key) {
            if (key.indexOf('track.') === 0 && Object.prototype.hasOwnProperty.call(controlGroups[key], 'pluginIdentity')) {
                controlGroups[key].pluginIdentity = null;
            }
        });
    }

    function clearBankSlot(index) {
        var slot = bankSlots[index];
        if (!slot) return;
        slot.uniqueId = null; slot.runtimeId = null; slot.admitted = false;
        Object.keys(controls).forEach(function (key) {
            if (controls[key].bankIndex === index) { controls[key].observed = null; controls[key].display = null; }
        });
        Object.keys(controlGroups).forEach(function (key) {
            if (key.indexOf('mixer.channel.' + index + '.') === 0 &&
                Object.prototype.hasOwnProperty.call(controlGroups[key], 'pluginIdentity')) controlGroups[key].pluginIdentity = null;
        });
        if (controlGroups['mixer.channel.' + index]) {
            controlGroups['mixer.channel.' + index].available = false;
            controlGroups['mixer.channel.' + index].uniqueId = null;
            controlGroups['mixer.channel.' + index].runtimeId = null;
            delete controlGroups['mixer.channel.' + index].error;
        }
    }

    function markBankError(index, error) {
        clearBankSlot(index);
        if (controlGroups['mixer.channel.' + index]) controlGroups['mixer.channel.' + index].error = errorData(error);
    }

    function clearBankObservations() { bankSlots.forEach(function (slot, index) { clearBankSlot(index); }); }

    function bankChannelIdentity(index, admit) {
        var slot = bankSlots[index];
        if (!slot || !slot.channel) fail('API_UNAVAILABLE', 'Bank channel is unavailable.');
        var id = hostText(invoke(slot.channel, 'getUniqueIDString', [activeMapping]));
        if (!id) { clearBankSlot(index); fail('NO_CHANNEL', 'Cubase did not report an identity for this bank slot.'); }
        var runtimeId = hostCount(invoke(slot.channel, 'getRuntimeID', [activeMapping]));
        if (slot.uniqueId !== null && (slot.uniqueId !== id || slot.runtimeId !== runtimeId)) clearBankSlot(index);
        slot.uniqueId = id; slot.runtimeId = runtimeId;
        if (admit) slot.admitted = true;
        var group = controlGroups['mixer.channel.' + index];
        group.available = true;
        delete group.error;
        group.uniqueId = id; group.runtimeId = runtimeId;
        return { uniqueId: id, runtimeId: runtimeId };
    }

    function selectedTrack() {
        try {
            var selection = host && host.mTrackSelection;
            var selected = selection && selection.mMixerChannel;
            var uniqueId = hostText(invoke(selected, 'getUniqueIDString', [activeMapping]));
            if (!uniqueId) fail('NO_TRACK_SELECTED', 'Cubase did not report an identity for the selected channel.');
            var runtimeId = hostCount(invoke(selected, 'getRuntimeID', [activeMapping]));
            if (observedTrackId !== null && (observedTrackId !== uniqueId || observedTrackRuntimeId !== runtimeId)) {
                clearTrackObservation();
            }
            observedTrackId = uniqueId;
            observedTrackRuntimeId = runtimeId;
            return { session: session, uniqueId: uniqueId, runtimeId: runtimeId };
        } catch (error) {
            clearTrackObservation();
            observedTrackId = null;
            observedTrackRuntimeId = null;
            throw error;
        }
    }

    function navigateTrack(request, args) {
        if (args.direction !== 'previous' && args.direction !== 'next') {
            fail('INVALID_ARGUMENT', 'direction must be previous or next.');
        }
        if (typeof args.expectedUniqueId !== 'string' || !args.expectedUniqueId) {
            fail('INVALID_ARGUMENT', 'expectedUniqueId must be the observed selected channel identity.');
        }
        if (args.expectedRuntimeId !== undefined && !integer(args.expectedRuntimeId, 0, MAX_INTEGER)) {
            fail('INVALID_ARGUMENT', 'expectedRuntimeId must be a nonnegative safe integer.');
        }
        var before = selectedTrack();
        if (before.uniqueId !== args.expectedUniqueId ||
            (args.expectedRuntimeId !== undefined && before.runtimeId !== args.expectedRuntimeId)) {
            fail('TRACK_CHANGED', 'The selected channel changed; query it again before navigating.',
                { currentUniqueId: before.uniqueId, currentRuntimeId: before.runtimeId });
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
        var result = { session: session, observed: transportObservation, errors: transportObservationErrors };
        try { result.features = timeFeatures(); }
        catch (error) { result.features = null; result.featureError = errorData(error); }
        return result;
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
        return { session: session, appVersion: appVersion, bridgeRevision: BRIDGE_REVISION, active: !!activeMapping,
            policy: { backgroundOnly: true, fallback: false },
            features: { directAccess: !!host && typeof host.makeDirectAccess === 'function',
                valueBindings: typeof page.makeValueBinding === 'function',
                commandBindings: typeof page.makeCommandBinding === 'function' },
            discovery: { controlsOperation: 'controls.list', rootsOperation: 'objects.list', commandsOperation: 'commands.list',
                controlTotal: Object.keys(controls).length, groupTotal: Object.keys(controlGroups).length,
                maximumPageSize: 16 },
            limits: { requests: MAX_REQUESTS, trackedIds: MAX_IDS, outputFrames: MAX_FRAMES,
                framesPerIdle: FRAMES_PER_IDLE, objectsPerRoot: MAX_OBJECTS, tagsPerRoot: MAX_TAGS, pluginsPerRoot: MAX_PLUGINS } };
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
        if (request.op === 'parameters.lock') return parametersSetEditLock(request, args);
        if (request.op === 'plugins.list') return pluginsList(args);
        if (request.op === 'plugins.set') return pluginsSet(request, args);
        if (request.op === 'controls.list') return controlList(args);
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
        if (!loggedInput) {
            loggedInput = true;
            trace('first MIDI input: matching device=' + (device === activeDevice));
        }
        if (device !== activeDevice) return;
        var request;
        try {
            request = decoder.accept(bytes, Date.now());
        } catch (error) {
            malformedFrames++;
            return;
        }
        if (!request) return;
        if (!loggedDecoded) { loggedDecoded = true; trace('first request decoded'); }
        if (seen[request.id]) return rejection(request.id, 'DUPLICATE_ID', 'This request ID was already admitted; it will not be executed again.');
        if (seenCount >= MAX_IDS) return rejection(request.id, 'REQUEST_LIMIT', 'Request ID tracking is full; reactivate the mapping page.');
        seen[request.id] = true;
        seenCount++;
        if (pending.length >= MAX_REQUESTS) return rejection(request.id, 'QUEUE_FULL', 'The request queue is full; this request was not executed.');
        pending.push(request);
    };

    page.mOnActivate = function (device, mapping) {
        trace('mapping activated');
        loggedInput = false;
        loggedDecoded = false;
        loggedIdle = false;
        loggedOutput = false;
        activeDevice = device;
        activeMapping = mapping;
        session = instance + '-' + (++generation);
        decoder.reset();
        pending = [];
        outbound = [];
        seen = Object.create(null);
        seenCount = 0;
        observedTrackId = null;
        observedTrackRuntimeId = null;
        clearTrackObservation();
        clearBankObservations();
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
        trace('mapping deactivated');
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
        observedTrackRuntimeId = null;
        clearTrackObservation();
        clearBankObservations();
        clearTransportObservation();
        Object.keys(controls).forEach(function (key) { controls[key].observed = null; controls[key].display = null; });
    };

    page.mOnIdle = function (device, mapping) {
        if (!loggedIdle) {
            loggedIdle = true;
            trace('first idle: matching device=' + (device === activeDevice) + ', mapping=' + (mapping === activeMapping));
        }
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
                try {
                    output.sendMidi(device, frame);
                    if (!loggedOutput) { loggedOutput = true; trace('first response frame sent'); }
                }
                catch (error) { transportError = String(error.message || error); outbound = []; break; }
            }
        } finally {
            inIdle = false;
        }
    };

    rootNames.forEach(function (key, index) { makeRoot(key, rootPaths[index]); });
    var transport = null;
    try { transport = host && host.mTransport && host.mTransport.mValue; }
    catch (error) { controlGroups.transport = { available: false, error: errorData(error) }; }
    var transportNames = ['start', 'stop', 'record', 'rewind', 'forward', 'cycle', 'metronome'];
    var transportValues = ['mStart', 'mStop', 'mRecord', 'mRewind', 'mForward', 'mCycleActive', 'mMetronomeActive'];
    transportNames.forEach(function (name, index) {
        makeControl('transport.' + name, 'mHostAccess.mTransport.mValue.' + transportValues[index],
            transport && transport[transportValues[index]], index < 3);
    });
    makeHostFields('transport.', 'mHostAccess.mTransport.mValue', transport,
        [['metronomeLevel', 'mMetronomeClickLevel']]);
    var channel = null;
    try { channel = host && host.mTrackSelection && host.mTrackSelection.mMixerChannel; }
    catch (error) { controlGroups['track.channel'] = { available: false, error: errorData(error) }; }
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
    makeSendControls(channel, 'mSends', 'track.send', [['on', 'mOn'], ['prePost', 'mPrePost'], ['level', 'mLevel']],
        'mHostAccess.mTrackSelection.mMixerChannel');
    var cueSends = makeSendControls(channel, 'mCueSends', 'track.cueSend',
        [['on', 'mOn'], ['prePost', 'mPrePost'], ['level', 'mLevel'], ['pan', 'mPan']],
        'mHostAccess.mTrackSelection.mMixerChannel');
    makeHostFields('track.cueSend.', 'mHostAccess.mTrackSelection.mMixerChannel.mCueSends', cueSends,
        [['bypass', 'mBypass']]);
    var selectedInstrument = hostBranch(channel, 'mInstrumentPluginSlot', 'track.instrument');
    makeHostFields('track.instrument.', 'mHostAccess.mTrackSelection.mMixerChannel.mInstrumentPluginSlot',
        selectedInstrument,
        [['on', 'mOn'], ['bypass', 'mBypass'], ['automationRead', 'mAutomationRead'], ['automationWrite', 'mAutomationWrite']]);
    makePluginBank('track.instrument', 'mHostAccess.mTrackSelection.mMixerChannel.mInstrumentPluginSlot', selectedInstrument);
    var effects = hostBranch(channel, 'mInsertAndStripEffects', 'track.effects');
    var strip = hostBranch(effects, 'mStripEffects', 'track.strip');
    [['gate', 'mGate'], ['compressor', 'mCompressor'], ['limiter', 'mLimiter'],
        ['saturator', 'mSaturator'], ['tools', 'mTools']].forEach(function (entry) {
        var group = 'track.strip.' + entry[0];
        var slot = hostBranch(strip, entry[1], group);
        makeHostFields(group + '.', 'mHostAccess.mTrackSelection.mMixerChannel.mInsertAndStripEffects.mStripEffects.' + entry[1],
            slot,
            [['on', 'mOn'], ['bypass', 'mBypass'], ['automationRead', 'mAutomationRead'], ['automationWrite', 'mAutomationWrite']]);
        if (!slot) return;
        controlGroups[group].pluginIdentity = null;
        try {
            slot.mOnChangePluginIdentity = function (device, mapping, name, vendor, version, format) {
                if (device !== activeDevice || mapping !== activeMapping ||
                    typeof name !== 'string' || typeof vendor !== 'string' || typeof version !== 'string' || typeof format !== 'string' ||
                    name.length > 4096 || vendor.length > 4096 || version.length > 4096 || format.length > 4096) return;
                try {
                    var current = selectedTrack();
                    clearGroupObservation(group);
                    controlGroups[group].pluginIdentity = { name: name, vendor: vendor, version: version,
                        formatVersion: format, trackUniqueId: current.uniqueId };
                } catch (error) { clearTrackObservation(); }
            };
        } catch (error) { controlGroups[group].identityError = errorData(error); }
        var bank = hostBranch(slot, 'mParameterBankZone', group + '.bank');
        if (!bank) return;
        for (var parameterIndex = 0; parameterIndex < 8; parameterIndex++) {
            var parameter = null;
            var failure = null;
            try { parameter = invoke(bank, 'makeParameterValue', []); }
            catch (error) { failure = errorData(error); }
            var key = group + '.parameter.' + parameterIndex;
            makeControl(key, group + '.mParameterBankZone.makeParameterValue(' + parameterIndex + ')', parameter, false);
            if (failure) controls[key].error = failure;
        }
        [['previous', 'mPrevBank'], ['next', 'mNextBank'], ['reset', 'mResetBank']].forEach(function (actionEntry) {
            var action = null;
            try { action = bank.mAction && bank.mAction[actionEntry[1]]; } catch (ignored) {}
            makeActionControl(group + '.bank.' + actionEntry[0], group + '.mParameterBankZone.mAction.' + actionEntry[1], action);
        });
    });
    function makePluginBank(group, path, slot, bankIndex) {
        controlGroups[group].pluginIdentity = null;
        if (slot) {
            try {
                slot.mOnChangePluginIdentity = function (device, mapping, name, vendor, version, format) {
                    if (!activeDevice || !activeMapping || device !== activeDevice || mapping !== activeMapping) return;
                    if ([name, vendor, version, format].some(function (v) { return typeof v !== 'string' || v.length > 4096; })) {
                        clearGroupObservation(group);
                        controlGroups[group].pluginIdentity = null;
                        return;
                    }
                    try {
                        var current = bankIndex === undefined ? selectedTrack() : bankChannelIdentity(bankIndex, false);
                        clearGroupObservation(group);
                        controlGroups[group].pluginIdentity = { name: name, vendor: vendor, version: version, formatVersion: format };
                        var identity = controlGroups[group].pluginIdentity;
                        if (bankIndex === undefined) { identity.trackUniqueId = current.uniqueId; identity.trackRuntimeId = current.runtimeId; }
                        else { identity.channelUniqueId = current.uniqueId; identity.channelRuntimeId = current.runtimeId; }
                    } catch (error) {
                        clearGroupObservation(group);
                        controlGroups[group].pluginIdentity = null;
                        if (bankIndex === undefined) clearTrackObservation(); else markBankError(bankIndex, error);
                    }
                };
            } catch (error) { controlGroups[group].identityError = errorData(error); }
        }
        var bank = hostBranch(slot, 'mParameterBankZone', group + '.bank');
        for (var i = 0; i < 8; i++) {
            var value = null, failure = null;
            try { value = invoke(bank, 'makeParameterValue', []); } catch (error) { failure = errorData(error); }
            var key = group + '.parameter.' + i;
            makeControl(key, path + '.mParameterBankZone.makeParameterValue(' + i + ')', value, false);
            controls[key].pluginBankGroup = group;
            if (bankIndex !== undefined) controls[key].bankIndex = bankIndex;
            if (failure) controls[key].error = failure;
        }
        [['previous', 'mPrevBank'], ['next', 'mNextBank'], ['reset', 'mResetBank']].forEach(function (entry) {
            var action = null;
            try { action = bank && bank.mAction && bank.mAction[entry[1]]; } catch (ignored) {}
            var key = group + '.bank.' + entry[0];
            makeActionControl(key, path + '.mParameterBankZone.mAction.' + entry[1], action);
            controls[key].pluginBankGroup = group;
            if (bankIndex !== undefined) controls[key].bankIndex = bankIndex;
        });
    }
    function makeInsertViewer(name, filter, index) {
        var group = 'track.insert.' + name;
        var path = 'mHostAccess.mTrackSelection.mMixerChannel.mInsertAndStripEffects.makeInsertEffectViewer(' + name + ')';
        var viewer;
        try {
            viewer = invoke(effects, 'makeInsertEffectViewer', ['CubaseAI MCP ' + name]);
            if (!viewer) fail('API_UNAVAILABLE', 'Insert viewer was not created: ' + name);
            if (filter === 'empty') viewer = invoke(viewer, 'includeEmptySlotsOnly', []);
            else if (filter === 'occupied') viewer = invoke(viewer, 'excludeEmptySlots', []);
            else if (filter === 'slot') viewer = invoke(viewer, 'accessSlotAtIndex', [index]);
            if (!viewer) fail('API_UNAVAILABLE', 'Insert viewer filter returned no object: ' + name);
            controlGroups[group] = { available: true, filter: filter, index: index, pluginIdentity: null };
        } catch (error) {
            controlGroups[group] = { available: false, filter: filter, index: index, error: errorData(error) };
            return;
        }
        makeHostFields(group + '.', path, viewer,
            [['on', 'mOn'], ['bypass', 'mBypass'], ['automationRead', 'mAutomationRead'], ['automationWrite', 'mAutomationWrite']]);
        ['on', 'bypass', 'automationRead', 'automationWrite'].forEach(function (field) {
            controls[group + '.' + field].pluginBankGroup = group;
        });
        try {
            viewer.mOnChangePluginIdentity = function (device, mapping, pluginName, vendor, version, format) {
                if (!activeDevice || !activeMapping || device !== activeDevice || mapping !== activeMapping) return;
                if ([pluginName, vendor, version, format].some(function (v) { return typeof v !== 'string' || v.length > 4096; })) {
                    clearGroupObservation(group);
                    controlGroups[group].pluginIdentity = null;
                    return;
                }
                try {
                    var current = selectedTrack();
                    clearGroupObservation(group);
                    controlGroups[group].pluginIdentity = { name: pluginName, vendor: vendor, version: version,
                        formatVersion: format, trackUniqueId: current.uniqueId, trackRuntimeId: current.runtimeId };
                } catch (error) { clearTrackObservation(); }
            };
        } catch (error) { controlGroups[group].identityError = errorData(error); }
        [['previous', 'mPrev'], ['next', 'mNext'], ['reset', 'mReset']].forEach(function (entry) {
            var action = null;
            try { action = viewer.mAction && viewer.mAction[entry[1]]; } catch (ignored) {}
            makeActionControl(group + '.viewer.' + entry[0], path + '.mAction.' + entry[1], action);
        });
        var bank = hostBranch(viewer, 'mParameterBankZone', group + '.bank');
        if (!bank) return;
        for (var i = 0; i < 8; i++) {
            var value = null, failure = null;
            try { value = invoke(bank, 'makeParameterValue', []); } catch (error) { failure = errorData(error); }
            var key = group + '.parameter.' + i;
            makeControl(key, path + '.mParameterBankZone.makeParameterValue(' + i + ')', value, false);
            controls[key].pluginBankGroup = group;
            if (failure) controls[key].error = failure;
        }
        [['previous', 'mPrevBank'], ['next', 'mNextBank'], ['reset', 'mResetBank']].forEach(function (entry) {
            var action = null;
            try { action = bank.mAction && bank.mAction[entry[1]]; } catch (ignored) {}
            makeActionControl(group + '.bank.' + entry[0], path + '.mParameterBankZone.mAction.' + entry[1], action);
        });
    }
    if (effects) {
        makeInsertViewer('all', 'all', null);
        makeInsertViewer('empty', 'empty', null);
        makeInsertViewer('occupied', 'occupied', null);
        try {
            var insertCount = hostCount(invoke(api.mDefaults, 'getNumberOfInsertEffectSlots', []));
            if (insertCount > 16) fail('HOST_LIMIT_EXCEEDED', 'Insert slot maximum exceeds the viewer budget.', { count: insertCount });
            controlGroups['track.insert.slots'] = { available: true, count: insertCount };
            for (var insertIndex = 0; insertIndex < insertCount; insertIndex++) makeInsertViewer('slot.' + insertIndex, 'slot', insertIndex);
        } catch (error) { controlGroups['track.insert.slots'] = { available: false, error: errorData(error) }; }
    } else {
        controlGroups['track.insert.slots'] = { available: false, error: { code: 'API_UNAVAILABLE', message: 'Insert effects branch is unavailable.' } };
    }
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
    var downmix = null;
    try { downmix = room && room.mSelectNextDownmixPresetValue; } catch (ignored) {}
    makeControl('controlRoom.nextDownmix', 'mHostAccess.mControlRoom.mSelectNextDownmixPresetValue', downmix, true);
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
    var phonesSlots = makeControlRoomChannels(room, 'controlRoom.phones', 'getMaxPhonesChannels', 'getPhonesChannelByIndex', roomMainFields, roomBudget);
    makeControlRoomChannels(room, 'controlRoom.externalInput', 'getMaxExternalInputChannels', 'getExternalInputChannelByIndex', basicRoomFields, roomBudget);
    makeControlRoomChannels(room, 'controlRoom.talkback', 'getMaxTalkbackChannels', 'getTalkbackChannelByIndex', basicRoomFields, roomBudget);
    makeControlRoomChannels(room, 'controlRoom.monitor', 'getMaxMonitorChannels', 'getMonitorChannelByIndex', basicRoomFields, roomBudget);
    var selectorBudget = { remaining: 64 };
    var cueCount = controlGroups['controlRoom.cue'].count;
    makeIndexedRoomValues(room, controlGroups['controlRoom.externalInput'].count, 'getSelectSourceExternalInputValueByIndex',
        'controlRoom.sourceExternalInput', 'mHostAccess.mControlRoom', selectorBudget);
    makeIndexedRoomValues(room, controlGroups['controlRoom.monitor'].count, 'getSelectTargetMonitorValueByIndex',
        'controlRoom.targetMonitor', 'mHostAccess.mControlRoom', selectorBudget);
    makeIndexedRoomValues(main, cueCount, 'getSelectSourceCueValueByIndex',
        'controlRoom.main.sourceCue', 'mHostAccess.mControlRoom.mMainChannel', selectorBudget);
    phonesSlots.forEach(function (phone, index) {
        makeIndexedRoomValues(phone, cueCount, 'getSelectSourceCueValueByIndex',
            'controlRoom.phones.' + index + '.sourceCue',
            'mHostAccess.mControlRoom.getPhonesChannelByIndex(' + index + ')', selectorBudget);
    });
    function makeBankInsertViewer(channel, index, name, filter, slotIndex) {
        var group = 'mixer.channel.' + index + '.insert.' + name;
        var path = 'mHostAccess.mMixConsole.makeMixerBankZone().makeMixerBankChannel(' + index + ').mInsertAndStripEffects.makeInsertEffectViewer(' + name + ')';
        var viewer;
        try {
            var effects = channel && channel.mInsertAndStripEffects;
            viewer = invoke(effects, 'makeInsertEffectViewer', ['CubaseAI MCP bank ' + index + ' ' + name]);
            if (!viewer) fail('API_UNAVAILABLE', 'Bank insert viewer was not created.');
            if (filter === 'empty') viewer = invoke(viewer, 'includeEmptySlotsOnly', []);
            else if (filter === 'occupied') viewer = invoke(viewer, 'excludeEmptySlots', []);
            else if (filter === 'slot') viewer = invoke(viewer, 'accessSlotAtIndex', [slotIndex]);
            if (!viewer) fail('API_UNAVAILABLE', 'Bank insert viewer filter returned no object.');
            controlGroups[group] = { available: true, filter: filter, index: slotIndex, pluginIdentity: null };
        } catch (error) {
            controlGroups[group] = { available: false, error: errorData(error) };
            return;
        }
        makeHostFields(group + '.', path, viewer,
            [['on', 'mOn'], ['bypass', 'mBypass'], ['automationRead', 'mAutomationRead'], ['automationWrite', 'mAutomationWrite']], false, index);
        ['on', 'bypass', 'automationRead', 'automationWrite'].forEach(function (field) {
            controls[group + '.' + field].pluginBankGroup = group;
        });
        try {
            viewer.mOnChangePluginIdentity = function (device, mapping, name, vendor, version, format) {
                if (!activeDevice || !activeMapping || device !== activeDevice || mapping !== activeMapping) return;
                if ([name, vendor, version, format].some(function (v) { return typeof v !== 'string' || v.length > 4096; })) {
                    clearGroupObservation(group);
                    controlGroups[group].pluginIdentity = null;
                    return;
                }
                clearGroupObservation(group);
                try {
                    var current = bankChannelIdentity(index, false);
                    controlGroups[group].pluginIdentity = { name: name, vendor: vendor, version: version,
                        formatVersion: format, channelUniqueId: current.uniqueId, channelRuntimeId: current.runtimeId };
                } catch (error) { markBankError(index, error); }
            };
        } catch (error) { controlGroups[group].identityError = errorData(error); }
        [['previous', 'mPrev'], ['next', 'mNext'], ['reset', 'mReset']].forEach(function (entry) {
            var action = null;
            try { action = viewer.mAction && viewer.mAction[entry[1]]; } catch (ignored) {}
            var key = group + '.viewer.' + entry[0];
            makeActionControl(key, path + '.mAction.' + entry[1], action);
            controls[key].bankIndex = index;
        });
        var bank = hostBranch(viewer, 'mParameterBankZone', group + '.bank');
        if (!bank) return;
        for (var parameter = 0; parameter < 8; parameter++) {
            var value = null, failure = null;
            try { value = invoke(bank, 'makeParameterValue', []); } catch (error) { failure = errorData(error); }
            var key = group + '.parameter.' + parameter;
            makeControl(key, path + '.mParameterBankZone.makeParameterValue(' + parameter + ')', value, false);
            controls[key].bankIndex = index;
            controls[key].pluginBankGroup = group;
            if (failure) controls[key].error = failure;
        }
        [['previous', 'mPrevBank'], ['next', 'mNextBank'], ['reset', 'mResetBank']].forEach(function (entry) {
            var action = null;
            try { action = bank.mAction && bank.mAction[entry[1]]; } catch (ignored) {}
            var key = group + '.bank.' + entry[0];
            makeActionControl(key, path + '.mParameterBankZone.mAction.' + entry[1], action);
            controls[key].bankIndex = index;
        });
    }
    var mixerBank = null;
    try {
        mixerBank = invoke(host && host.mMixConsole, 'makeMixerBankZone', ['CubaseAI MCP']);
        controlGroups['mixer.bank'] = { available: !!mixerBank };
    } catch (error) { controlGroups['mixer.bank'] = { available: false, error: errorData(error) }; }
    [['previous', 'mPrevBank'], ['next', 'mNextBank'], ['left', 'mShiftLeft'],
        ['right', 'mShiftRight'], ['reset', 'mResetBank']].forEach(function (entry) {
        var action = null;
        try { action = mixerBank && mixerBank.mAction && mixerBank.mAction[entry[1]]; } catch (ignored) {}
        makeActionControl('mixer.bank.' + entry[0], 'mHostAccess.mMixConsole.makeMixerBankZone().mAction.' + entry[1],
            action);
    });
    if (mixerBank) {
        for (var bankIndex = 0; bankIndex < 8; bankIndex++) {
            var bankChannel = null, channelError = null;
            try {
                bankChannel = invoke(mixerBank, 'makeMixerBankChannel', []);
                if (!bankChannel) fail('API_UNAVAILABLE', 'Mixer bank channel was not created.');
            } catch (error) { channelError = errorData(error); }
            bankSlots[bankIndex] = { channel: bankChannel, uniqueId: null, runtimeId: null, admitted: false };
            var channelGroup = 'mixer.channel.' + bankIndex;
            controlGroups[channelGroup] = { available: false, uniqueId: null, runtimeId: null };
            if (channelError) controlGroups[channelGroup].error = channelError;
            var values = null;
            try { values = bankChannel && bankChannel.mValue; } catch (error) { channelError = errorData(error); }
            var bankFields = [['volume', 'mVolume'], ['pan', 'mPan'], ['mute', 'mMute'], ['solo', 'mSolo'],
                ['recordEnable', 'mRecordEnable'], ['monitorEnable', 'mMonitorEnable'], ['selected', 'mSelected'],
                ['automationRead', 'mAutomationRead'], ['automationWrite', 'mAutomationWrite'],
                ['meter.level', 'mVUMeter'], ['meter.maximum', 'mVUMeterMax'],
                ['meter.clip', 'mVUMeterClip'], ['meter.peak', 'mVUMeterPeak']];
            bankFields.forEach(function (field) {
                var key = channelGroup + '.' + field[0], hostValue = null, failure = channelError;
                try { if (values) hostValue = values[field[1]]; } catch (error) { failure = errorData(error); }
                makeControl(key, 'mHostAccess.mMixConsole.makeMixerBankZone().makeMixerBankChannel(' + bankIndex + ').mValue.' + field[1],
                    hostValue, false, field[0].indexOf('meter.') === 0);
                controls[key].bankIndex = bankIndex;
                if (failure) controls[key].error = failure;
            });
            var bankPath = 'mHostAccess.mMixConsole.makeMixerBankZone().makeMixerBankChannel(' + bankIndex + ')';
            var bankFilter = hostBranch(bankChannel, 'mPreFilter', channelGroup + '.filter');
            makeHostFields(channelGroup + '.filter.', bankPath + '.mPreFilter', bankFilter,
                [['bypass', 'mBypass'], ['gain', 'mGain'], ['phase', 'mPhaseSwitch'],
                 ['highCutOn', 'mHighCutOn'], ['highCutFrequency', 'mHighCutFreq'], ['highCutSlope', 'mHighCutSlope'],
                 ['lowCutOn', 'mLowCutOn'], ['lowCutFrequency', 'mLowCutFreq'], ['lowCutSlope', 'mLowCutSlope']], false, bankIndex);
            var bankEq = hostBranch(bankChannel, 'mChannelEQ', channelGroup + '.eq');
            for (var eqIndex = 1; eqIndex <= 4; eqIndex++) {
                var eqField = 'mBand' + eqIndex;
                makeHostFields(channelGroup + '.eq.' + eqIndex + '.', bankPath + '.mChannelEQ.' + eqField,
                    hostBranch(bankEq, eqField, channelGroup + '.eq.' + eqIndex),
                    [['gain', 'mGain'], ['frequency', 'mFreq'], ['q', 'mQ'], ['on', 'mOn'], ['filterType', 'mFilterType']], false, bankIndex);
            }
            makeSendControls(bankChannel, 'mSends', channelGroup + '.send',
                [['on', 'mOn'], ['prePost', 'mPrePost'], ['level', 'mLevel']], bankPath, bankIndex);
            var bankCues = makeSendControls(bankChannel, 'mCueSends', channelGroup + '.cueSend',
                [['on', 'mOn'], ['prePost', 'mPrePost'], ['level', 'mLevel'], ['pan', 'mPan']], bankPath, bankIndex);
            makeHostFields(channelGroup + '.cueSend.', bankPath + '.mCueSends', bankCues,
                [['bypass', 'mBypass']], false, bankIndex);
            var bankEffects = hostBranch(bankChannel, 'mInsertAndStripEffects', channelGroup + '.effects');
            makeBankInsertViewer(bankChannel, bankIndex, 'all', 'all', null);
            makeBankInsertViewer(bankChannel, bankIndex, 'empty', 'empty', null);
            makeBankInsertViewer(bankChannel, bankIndex, 'occupied', 'occupied', null);
            try {
                var bankInsertCount = hostCount(invoke(api.mDefaults, 'getNumberOfInsertEffectSlots', []));
                if (bankInsertCount > 16) fail('HOST_LIMIT_EXCEEDED', 'Bank insert slot maximum exceeds the viewer limit.', { count: bankInsertCount });
                method(bankEffects, 'makeInsertEffectViewer');
                controlGroups[channelGroup + '.insert.slots'] = { available: true, count: bankInsertCount };
                for (var bankInsertIndex = 0; bankInsertIndex < bankInsertCount; bankInsertIndex++)
                    makeBankInsertViewer(bankChannel, bankIndex, 'slot.' + bankInsertIndex, 'slot', bankInsertIndex);
            } catch (error) { controlGroups[channelGroup + '.insert.slots'] = { available: false, error: errorData(error) }; }

            var bankQuick = hostBranch(bankChannel, 'mQuickControls', channelGroup + '.quick');
            makeQuickControls(channelGroup + '.quick.', bankPath + '.mQuickControls', bankQuick, bankIndex);
            var bankInstrument = hostBranch(bankChannel, 'mInstrumentPluginSlot', channelGroup + '.instrument');
            makeHostFields(channelGroup + '.instrument.', bankPath + '.mInstrumentPluginSlot', bankInstrument,
                [['on', 'mOn'], ['bypass', 'mBypass'], ['automationRead', 'mAutomationRead'], ['automationWrite', 'mAutomationWrite']], false, bankIndex);
            makePluginBank(channelGroup + '.instrument', bankPath + '.mInstrumentPluginSlot', bankInstrument, bankIndex);
            var bankStrip = hostBranch(bankEffects, 'mStripEffects', channelGroup + '.strip');
            [['gate', 'mGate'], ['compressor', 'mCompressor'], ['limiter', 'mLimiter'],
                ['saturator', 'mSaturator'], ['tools', 'mTools']].forEach(function (entry) {
                var group = channelGroup + '.strip.' + entry[0];
                var bankStripSlot = hostBranch(bankStrip, entry[1], group);
                var stripPath = bankPath + '.mInsertAndStripEffects.mStripEffects.' + entry[1];
                makeHostFields(group + '.', stripPath, bankStripSlot,
                    [['on', 'mOn'], ['bypass', 'mBypass'], ['automationRead', 'mAutomationRead'], ['automationWrite', 'mAutomationWrite']], false, bankIndex);
                makePluginBank(group, stripPath, bankStripSlot, bankIndex);
            });
        }
    }
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
    trace('controller constructed ' + BRIDGE_REVISION);
    return { deviceDriver: driver, page: page, midiInput: input, midiOutput: output };
}

module.exports = { createController: createController };
