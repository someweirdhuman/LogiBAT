var WebSocket = require('ws');
var { NotifyIcon, Icon, Menu } = require('not-the-systray');
var path = require('path');

class App {
   constructor() {
      this.tray = new TrayManager();
      this.deviceManager = new DeviceManager();
   }
}

class TrayManager {
   constructor() {
      this.icons = {};
      this.handleMenu = this.handleMenu.bind(this);
      this.loadIcons = this.loadIcons.bind(this);
      this.onSelect = this.onSelect.bind(this);
      this.updateTray = this.updateTray.bind(this);
      this.setTrackedDevice = this.setTrackedDevice.bind(this);
      this.updateStateCycle = this.updateStateCycle.bind(this);

      this.loadIcons();
      this.icon = new NotifyIcon({
         icon: this.icons['loading'],
         tooltip: 'LOADING STATE',
         onSelect: this.onSelect,
      });

      this.trackedDevice = null;

      this.menu = new Menu([{ id: 2, text: 'Set Default Device', items: [] }, { separator: true }, { id: 1, text: 'Exit' }]);

      setInterval(this.updateStateCycle, 60000);
   }

   //updates submenu with devices list
   updateTray(devices) {
      if (!devices) return false;
      this.menu.update(2, {
         items: Object.values(devices).map((device) => {
            if (this.trackedDevice == null) {
               this.setTrackedDevice(device.id);
            }

            return {
               id: Number(device.deviceUnitId),
               text: device.displayName + '(' + device.pid + ')',
               checked: device.id == this.trackedDevice,
            };
         }),
      });
   }

   //on menu click
   onSelect({ target, rightButton, mouseX, mouseY }) {
      if (rightButton) {
         this.handleMenu(mouseX, mouseY);
      }
   }

   //changes tracked device and triggers updateStateCycle
   setTrackedDevice(deviceId) {
      if (this.trackedDevice == deviceId) return false;

      this.trackedDevice = deviceId;
      this.updateStateCycle();
   }

   //updates text, icon in systray
   updateStateCycle() {
      var devices = Object.values(app.deviceManager.devices).filter((device) => device.percentage != null);
      var mainDevice = devices.filter((device) => device.id == this.trackedDevice);
      var finalIcon = this.icons['questionmark'];

      if (mainDevice.length == 1) {
         finalIcon = this.icons[Math.round(mainDevice[0].percentage)];
      }

      this.icon.update({
         tooltip: devices
            .map((device) => {
               return device.displayName + ' ' + device.percentage + '%';
            })
            .join('\n'),
         icon: finalIcon,
      });
   }

   //handle menu click
   handleMenu(x, y) {
      const id = this.menu.showSync(x, y);
      if (id == 1) {
         process.exit();
      }

      var devices = Object.values(app.deviceManager.devices).filter((device) => device.deviceUnitId == id);

      if (devices.length == 1) {
         var selectedDevice = devices[0];
         this.setTrackedDevice(selectedDevice.id);
      }
   }

   //load icon assets
   loadIcons() {
      for (var i = 1; i <= 100; i++) {
         this.icons[i] = Icon.load(path.join('./ico', [i, '.ico'].join('')), Icon.small);
      }
      this.icons['questionmark'] = Icon.load(path.join('./ico', 'questionmark.ico'), Icon.small);
      this.icons['loading'] = Icon.load(path.join('./ico', 'loading.ico'), Icon.small);
   }
}

class DeviceManager {
   constructor() {
      this.listen = this.listen.bind(this);
      this.getDeviceList = this.getDeviceList.bind(this);
      this.requestBatteryState = this.requestBatteryState.bind(this);
      this.registerDevice = this.registerDevice.bind(this);
      this.updateDeviceBattery = this.updateDeviceBattery.bind(this);

      this.connect = this.connect.bind(this);
      this.connect();

      this.devices = {};

      setInterval(this.getDeviceList, 10000);
      setInterval(this.connect, 5000);
   }

   //connect to websocket, this function is on interval to automatically reconnect if hub wasnt started before or crashed
   connect() {
      if (this.ws === undefined || (this.ws && (this.ws.readyState === 3 || this.ws.readyState == 0))) {
         this.ws = new WebSocket('ws://localhost:9010', 'json');
         this.ws.on('error', () => {});
         this.listen();
      }
   }

   //request device list from websocket
   getDeviceList() {
      this.ws.send(JSON.stringify({ path: '/devices/list', verb: 'GET' }));
   }

   //request battery state from websocket based on getDeviceList() device list
   requestBatteryState(deviceId) {
      try {
         this.ws.send(
            JSON.stringify({
               path: '/battery/' + deviceId + '/state',
               verb: 'GET',
            }),
         );
      } catch (err) {
         console.error(err);
      }
   }

   //device received from websocket message gets inserted into a object/map
   registerDevice(device) {
      if (device.id in this.devices) return false;
      if (device.connectionType != 'WIRELESS') return false;

      this.devices[device.id] = {
         id: device.id,
         pid: device.pid,
         deviceUnitId: device.deviceUnitId,
         displayName: device.displayName,
         extendedDisplayName: device.extendedDisplayName,
         percentage: null,
      };
   }

   //if device is already registered then we can update battery from another websocket message
   updateDeviceBattery(deviceId, percentage) {
      if (!deviceId in this.devices) return false;
      this.devices[deviceId].percentage = percentage;

      app.tray.updateTray(this.devices);
   }

   //start listening to websocket
   listen() {
      this.ws.on('open', () => {
         this.getDeviceList();
      });

      this.ws.on('message', (data) => {
         try {
            var json = JSON.parse(data);

            //on receiving device list from getDeviceList();
            if (json.path == '/devices/list' && json.result.code == 'SUCCESS') {
               json.payload.deviceInfos.forEach((device) => {
                  this.registerDevice(device);
                  this.requestBatteryState(device.id);
               });
            }

            //on receiving battery state of %deviceId% from requestBatteryState(%deviceId%)
            if (json.path.includes('/battery/') && json.path.includes('/state') && json.result.code == 'SUCCESS') {
               var deviceId = json.path.replace('/battery/', '').replace('/state', '');
               var percentage = json.payload.percentage;
               this.updateDeviceBattery(deviceId, percentage);
            }
         } catch (err) {
            console.error(err);
         }
      });
   }
}

var app = new App();

process.on('SIGINT', () => {
   process.exit();
});
