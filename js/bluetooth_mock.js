const mockBluetooth = {
  requestDevice: async opts => {
    function FakeCharacteristic(type) {
      this.type = type
      this._listeners = {}
    }
    FakeCharacteristic.prototype.startNotifications = function () {
      return Promise.resolve(this)
    }
    FakeCharacteristic.prototype.addEventListener = function (event, cb) {
      this._listeners[event] = cb
      if (event === 'characteristicvaluechanged') {
        setTimeout(() => {
          let value
          if (this.type === 'power') {
            value = {
              getUint16: (offset, littleEndian) => (offset === 0 ? 0 : 150),
              getInt16: () => 150,
              byteLength: 8
            }
          } else if (this.type === 'hr') {
            value = {
              getUint8: () => 0,
              getUint16: () => 120,
              byteLength: 2
            }
          }
          cb({ target: { value } })
        }, 100)
      }
    }
    FakeCharacteristic.prototype.writeValue = function (value) {
      return Promise.resolve()
    }

    function FakeService(type) {
      this.type = type
    }
    FakeService.prototype.getCharacteristic = function (uuid) {
      if (this.type === 'fitness') {
        return Promise.resolve(new FakeCharacteristic('power'))
      } else if (this.type === 'cycling') {
        return Promise.resolve(new FakeCharacteristic('power'))
      } else if (this.type === 'hr') {
        return Promise.resolve(new FakeCharacteristic('hr'))
      }
      return Promise.resolve(new FakeCharacteristic('unknown'))
    }

    function FakeServer(type) {
      this.type = type
    }
    FakeServer.prototype.getPrimaryService = function (uuid) {
      if (uuid === '00001826-0000-1000-8000-00805f9b34fb')
        return Promise.resolve(new FakeService('fitness'))
      if (uuid === '00001818-0000-1000-8000-00805f9b34fb')
        return Promise.resolve(new FakeService('cycling'))
      if (uuid === 'heart_rate') return Promise.resolve(new FakeService('hr'))
      return Promise.resolve(new FakeService('unknown'))
    }

    function FakeDevice(name) {
      this.name = name
      this.gatt = {
        connect: () => Promise.resolve(new FakeServer(name))
      }
      this.addEventListener = function () {}
    }

    if (opts.filters && opts.filters[0].services.includes('heart_rate'))
      return new FakeDevice('Fake HRM')
    return new FakeDevice('Fake Ergo')
  }
}
export default mockBluetooth
