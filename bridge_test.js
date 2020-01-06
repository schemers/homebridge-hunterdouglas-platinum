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
