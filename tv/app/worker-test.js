self.onmessage = function (e) {
    var result = { ran: true, wasm: typeof WebAssembly !== 'undefined', indexedDB: typeof indexedDB !== 'undefined' };
    self.postMessage(result);
};
