'use strict';
var api = require('midiremote_api_v1');
var deviceDriver = require('./controller').createController(api, 'default').deviceDriver;
