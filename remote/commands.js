'use strict';

module.exports = Object.freeze([
    Object.freeze({ key: 'edit.undo', category: 'Edit', name: 'Undo',
        context: 'Acts on the active Cubase undo context; no selection is created.' }),
    Object.freeze({ key: 'edit.redo', category: 'Edit', name: 'Redo',
        context: 'Acts on the active Cubase redo context; no selection is created.' }),
    Object.freeze({ key: 'midi.quantize', category: 'Quantize Category', name: 'Quantize',
        context: 'Uses the current selection and quantize settings; no editor is opened or focused.' })
]);