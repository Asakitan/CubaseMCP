'use strict';

var api = require('midiremote_api_v1');
var controller = require('./controller').createController(api);
var deviceDriver = controller.deviceDriver;

module.exports = deviceDriver;