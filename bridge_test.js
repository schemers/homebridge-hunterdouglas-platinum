const Bridge = require('./lib/Bridge')

let controller = new Bridge.Controller({ ip_address: '192.168.86.143' })

controller
  .getConfig()
  .then(config => {
    console.log('got config:', config)
  })
  .catch(err => {
    console.log('caught error:', err)
  })
