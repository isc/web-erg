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
        setInterval(() => {
          let value
          const watts = localStorage.getItem('ergPower') || 0
          if (this.type === 'power') {
            const now = Date.now()
            const targetRPM = watts > 0 ? 60 : 0
            let flags = 0x00
            let crankRevs = 0
            let crankEventTime = 0
            if (targetRPM > 0) {
              flags = 0x10 // Données de cadence disponibles
              crankRevs = Math.floor((now / 1000) * (targetRPM / 60)) % 65536
              crankEventTime = ((now / 1000) * 1024) % 65536
            }
            value = {
              getUint16: (offset, littleEndian) => {
                if (offset === 0) return flags
                if (offset === 4) return crankRevs
                if (offset === 6) return crankEventTime
                return 0
              },
              getInt16: (offset, littleEndian) => {
                if (offset === 2) return watts // Instantaneous power
                return 0
              },
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
        }, 1000)
      }
    }
    FakeCharacteristic.prototype.writeValue = function (value) {
      return Promise.resolve()
    }
    FakeCharacteristic.prototype.readValue = function () {
      return Promise.resolve({ getUint8: () => 37 })
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
