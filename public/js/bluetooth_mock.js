const CONTROL_POINT = '00002ad9-0000-1000-8000-00805f9b34fb'
const POWER_MEASUREMENT = '00002a63-0000-1000-8000-00805f9b34fb'

// Keyed by the characteristic UUID the caller asks for, the way a real GATT server is: dispatching
// on the service instead meant a service could only ever hand back one characteristic shape.
const CHARACTERISTIC_TYPES = {
  [CONTROL_POINT]: 'control',
  [POWER_MEASUREMENT]: 'power',
  heart_rate_measurement: 'hr',
  battery_level: 'battery'
}

const mockBluetooth = {
  requestDevice: async opts => {
    const failure = localStorage.getItem('mockBluetoothFailure')
    if (failure) throw new Error(failure)

    function FakeCharacteristic(type) {
      this.type = type
      this._listeners = {}
    }
    FakeCharacteristic.prototype.startNotifications = function () {
      return Promise.resolve(this)
    }
    FakeCharacteristic.prototype.addEventListener = function (event, cb) {
      this._listeners[event] = cb
      // Only the measurement characteristics stream. The control point answers by indication, and
      // faking a stream of power packets on it made the response parser choke.
      if (event !== 'characteristicvaluechanged') return
      if (this.type !== 'power' && this.type !== 'hr') return
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
            flags = 0x10 // Cadence data present
            crankRevs = Math.floor((now / 1000) * (targetRPM / 60)) % 65536
            crankEventTime = ((now / 1000) * 1024) % 65536
          }
          value = {
            getUint16: offset => {
              if (offset === 0) return flags
              if (offset === 4) return crankRevs
              if (offset === 6) return crankEventTime
              return 0
            },
            getInt16: offset => (offset === 2 ? watts : 0),
            byteLength: 8
          }
        } else {
          value = {
            // Offset 0 is the flags byte, offset 1 the 8-bit rate. Answering 0 to both, as this
            // used to, meant the mock reported a heart rate of zero.
            getUint8: offset => (offset === 0 ? 0x00 : 120),
            getUint16: () => 120,
            byteLength: 2
          }
        }
        cb({ target: { value } })
      }, 1000)
    }
    FakeCharacteristic.prototype.writeValue = function () {
      return Promise.resolve()
    }
    FakeCharacteristic.prototype.writeValueWithResponse = function () {
      return Promise.resolve()
    }
    FakeCharacteristic.prototype.readValue = function () {
      return Promise.resolve({ getUint8: () => 37 })
    }

    const server = {
      getPrimaryService: () =>
        Promise.resolve({
          getCharacteristic: uuid =>
            Promise.resolve(
              new FakeCharacteristic(CHARACTERISTIC_TYPES[uuid] || 'unknown')
            )
        })
    }

    const name = opts.filters?.[0].services.includes('heart_rate')
      ? 'Fake HRM'
      : 'Fake Ergo'
    return {
      name,
      gatt: { connect: () => Promise.resolve(server) },
      addEventListener: () => {}
    }
  }
}
export default mockBluetooth
