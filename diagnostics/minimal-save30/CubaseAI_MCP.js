var api = require('midiremote_api_v1');
var logger = typeof console === 'undefined' ? null : console;
var deviceDriver = require('./controller').createController(api, logger).deviceDriver;
