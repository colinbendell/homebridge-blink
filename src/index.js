const {Blink} = require('./blink');

// Blink Security Platform Plugin for HomeBridge (https://github.com/colinbendell/homebridge-blink-for-home)
//
// Remember to add platform to config.json. Example:
// "platforms": [
//     {
//         "platform": "BlinkForHome",
//         "name": "Blink",
//         "username": "me@example.com",
//         "password": "PASSWORD",
//         "pin": "01234"
//     }
// ]

const PLUGIN_NAME = 'homebridge-blink-for-home';
const PLATFORM_NAME = 'Blink';

const BLINK_STATUS_EVENT_LOOP = 10; // internal poll interval

class HomebridgeBlink {
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.accessoryLookup = [];
        this.cachedAccessories = [];

        this.accessories = {};
        if (!this.config.username && !this.config.password) {
            throw Error('Missing Blink account credentials {"email","password"} in config.json');
        }

        api.on('didFinishLaunching', () => this.init());
    }

    async init() {
        this.log.info('Init Blink');
        // const updateAccessories = function (data = [], accessories = new Map()) {
        //     for (const entry of data) {
        //         if (accessories.has(data.canonicalID)) accessories.get(data.canonicalID).data = entry;
        //     }
        // };
        //
        // const handleUpdates = data => updateAccessories(data, this.accessoryLookup);

        try {
            this.blink = await this.setupBlink();
            // TODO: signal updates? (alarm state?)
            // await this.conn.subscribe(handleUpdates);
            // await this.conn.observe(handleUpdates);

            const hideDeviceIds = this.config['hide-device-ids'] ?? [];
            const data = [...this.blink.networks.values(), ...this.blink.cameras.values()];
            this.accessoryLookup = data.map(entry => entry.createAccessory(this.cachedAccessories))
                .filter(entry => !(hideDeviceIds.includes(entry.uuid)));

            this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.cachedAccessories);
            this.cachedAccessories = [];
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME,
                this.accessoryLookup.map(blinkDevice => blinkDevice.accessory).filter(e => !!e));

            // TODO: add new device discovery & removal
            await this.poll();
        }
        catch (err) {
            this.log.error(err);
            this.log.error('NOTE: Blink devices in HomeKit will not be responsive.');
            for (const accessory of this.cachedAccessories) {
                for (const service of accessory.services) {
                    for (const characteristic of service.characteristics) {
                        // reset getter and setter
                        characteristic.on('get', callback => callback('error'));
                        characteristic.on('set', (value, callback) => callback('error'));
                        characteristic.getValue();
                    }
                }
            }
        }
    }

    async poll() {
        const intervalPoll = () => {
            if (this.timerID) clearInterval(this.timerID);
            this.poll();
        };

        // await this.blink.refreshCameraThumbnail();
        try {
            await this.blink.refreshData();
        }
        catch (err) {
            this.log.error(err);
        }

        this.timerID = setInterval(intervalPoll, BLINK_STATUS_EVENT_LOOP * 1000);
    }

    async setupBlink() {
        if (!this.config.username && !this.config.password) {
            throw Error('Missing Blink {"email","password"} in config.json');
        }
        const clientUUID = this.api.hap.uuid.generate(`${this.config.name}${this.config.username}`);
        const auth = {
            email: this.config.username,
            password: this.config.password,
            pin: this.config.pin,
        };

        const blink = new Blink(clientUUID, auth, this.api, this.log, this.config);
        try {
            await blink.authenticate();
            await blink.refreshData();
            // TODO: move this off the startup loop?
            if (this.config['enable-startup-diagnostic']) await blink.diagnosticDebug();
        }
        catch (e) {
            this.log.error(e);
            throw new Error('Unable to authenticate with Blink. Missing 2FA PIN?');
        }

        return blink;
    }

    configureAccessory(accessory) {
        this.cachedAccessories.push(accessory);
    }
}

module.exports = function(homebridge) {
    homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, HomebridgeBlink, true);
    return homebridge;
};
