'use strict';

var api = require('midiremote_api_v1');
var logger = typeof console === 'undefined' ? null : console;
var controller = require('./controller').createController(api, logger);
var deviceDriver = controller.deviceDriver;
