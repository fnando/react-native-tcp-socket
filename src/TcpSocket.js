'use strict';

import { NativeModules } from 'react-native';
const Buffer = (global.Buffer = global.Buffer || require('buffer').Buffer);
const Sockets = NativeModules.TcpSockets;

const STATE = {
    DISCONNECTED: 0,
    CONNECTING: 1,
    CONNECTED: 2,
};

export default class TcpSocket {
    constructor(id, eventEmitter) {
        this._id = id;
        this._eventEmitter = eventEmitter;
        this._state = STATE.DISCONNECTED;
    }

    on(event, callback) {
        switch (event) {
            case 'data':
                this._eventEmitter.addListener('data', (evt) => {
                    if (evt.id !== this._id) return;
                    const bufferTest = Buffer.from(evt.data, 'base64');
                    callback(bufferTest);
                });
                break;
            case 'error':
                this._eventEmitter.addListener('error', (evt) => {
                    if (evt.id !== this._id) return;
                    callback(evt.error);
                });
                break;
            default:
                this._eventEmitter.addListener(event, (evt) => {
                    if (evt.id !== this._id) return;
                    callback();
                });
                break;
        }
    }

    off(event, callback) {
        this._eventEmitter.removeListener(event, callback);
    }

    connect(options, callback) {
        this._registerEvents();
        // Normalize args
        options.host = options.host || 'localhost';
        options.port = Number(options.port) || 0;
        options.localPort = Number(options.localPort) || 0;
        options.localAddress = options.localAddress || '0.0.0.0';
        options.interface = options.interface || '';
        const connectListener = this._eventEmitter.addListener('connect', (ev) => {
            if (this._id !== ev.id) return;
            connectListener.remove();
            if (callback) callback(ev.address);
        });
        if (options.timeout) this.setTimeout(options.timeout);
        else if (this._timeout) this._activeTimer(this._timeout.msecs);
        this._state = STATE.CONNECTING;
        this._destroyed = false;
        Sockets.connect(this._id, options.host, options.port, options);
        return this;
    }

    _activeTimer(msecs, wrapper) {
        if (this._timeout && this._timeout.handle) clearTimeout(this._timeout.handle);

        if (!wrapper) {
            const self = this;
            wrapper = function() {
                self._timeout = null;
                self._eventEmitter.emit('timeout');
            };
        }

        this._timeout = {
            handle: setTimeout(wrapper, msecs),
            wrapper: wrapper,
            msecs: msecs,
        };
    }

    _clearTimeout() {
        if (this._timeout) {
            clearTimeout(this._timeout.handle);
            this._timeout = null;
        }
    }

    setTimeout(msecs, callback) {
        if (msecs === 0) {
            this._clearTimeout();
            if (callback) this._eventEmitter.removeListener('timeout', callback);
        } else {
            if (callback) this._eventEmitter.once('timeout', callback);

            this._activeTimer(msecs);
        }
        return this;
    }

    address() {
        return this._address;
    }

    end(data, encoding) {
        if (this._destroyed) return;
        if (data) this.write(data, encoding);
        this._destroyed = true;
        Sockets.end(this._id);
    }

    destroy() {
        if (!this._destroyed) {
            this._destroyed = true;
            this._clearTimeout();
            Sockets.destroy(this._id);
        }
    }

    _registerEvents() {
        this._eventEmitter.addListener('connect', (ev) => {
            if (this._id !== ev.id) return;
            this._onConnect(ev.address);
        });
        this._eventEmitter.addListener('close', (ev) => {
            if (this._id !== ev.id) return;
            this._onClose(ev.hadError);
        });
        this._eventEmitter.addListener('error', (ev) => {
            if (this._id !== ev.id) return;
            this._onError(ev.error);
        });
    }

    _unregisterEvents() {
        this._eventEmitter.listeners().forEach((listener) => listener.remove());
    }

    _onConnect(address) {
        this.setConnected(address);
    }

    _onClose() {
        this.setDisconnected();
    }

    _onError() {
        this.destroy();
    }

    /**
     *
     * @param {string | Buffer | Uint8Array} buffer
     * @param {string} encoding
     * @param {Function} callback
     */
    write(buffer, encoding, callback) {
        const self = this;
        if (this._state === STATE.DISCONNECTED) throw new Error('Socket is not connected.');

        callback = callback || (() => {});
        let str;
        if (typeof buffer === 'string') str = Buffer.from(buffer, encoding).toString('base64');
        else if (Buffer.isBuffer(buffer)) str = buffer.toString('base64');
        else if (buffer instanceof Uint8Array || Array.isArray(buffer)) str = Buffer.from(buffer);
        else
            throw new TypeError(
                `Invalid data, chunk must be a string or buffer, not ${typeof buffer}`
            );

        Sockets.write(this._id, str, function(err) {
            if (self._timeout) self._activeTimer(self._timeout.msecs);
            if (err) return callback(err);
            callback();
        });
    }

    setConnected(address) {
        this._state = STATE.CONNECTED;
        this._address = address;
    }

    setDisconnected() {
        if (this._state === STATE.DISCONNECTED) return;
        this._unregisterEvents();
        this._state = STATE.DISCONNECTED;
    }
}