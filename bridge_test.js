const Bridge = require('./lib/Bridge')
const util = require('util')

let controller = new Bridge.Controller({ ip_address: '192.168.86.143' })

controller
  .getConfig()
  .then(config => {
    console.log('got config:', util.inspect(config, { depth: 10 }))
    return controller.getStatus()
  })
  .then(status => {
    console.log('got status:', util.inspect(status, { depth: 10 }))
  })
  .catch(err => {
    console.log('caught error:', err)
  })

/*

Config {
  softwareVersion: '2018-HD gateway 2.18',
  serialNumber: '000ABCDEF0123456',
  rooms: Map {
    '00': {
      id: '00',
      name: 'Master',
      shadeIds: [
        '00', '01',
        '02', '03',
        '04', '05',
        '06'
      ]
    }
  },
  shades: Map {
    '00' => { id: '00', roomId: '00', name: 'Window Left', state: 255 },
    '01' => { id: '01', roomId: '00', name: 'Left Door ', state: 255 },
    '02' => { id: '02', roomId: '00', name: 'Door', state: 255 },
    '03 => {
      id: '03',
      roomId: '00',
      name: 'Window Right Of Door',
      state: 255
    },
    '04' => { id: '04', roomId: '00', name: 'Center Bed', state: 255 },
    '05' => { id: '05', roomId: '00', name: 'Right Bed', state: 255 },
    '06' => { id: '06', roomId: '00', name: 'Left Bed', state: 255 }
  },
  ledBrightness: 8
}

Status {
  shades: Map {
    '00' => 255,
    '01' => 255,
    '02' => 255,
    '03' => 255,
    '04' => 255,
    '05' => 255,
    '06' => 255
  }
}

*/
