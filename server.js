/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * Main entry-point for the Zones API.
 */

var path = require('path');
var fs = require('fs');

var filed = require('filed');
var restify = require('restify');
var ldap = require('ldapjs');
var Logger = require('bunyan');

var machines = require('./lib/machines');



/*
 * Loads and parse the configuration file at config.json
 */
function loadConfig() {
  var configPath = path.join(__dirname, 'config.json');

  if (!path.existsSync(configPath)) {
    log.error('Config file not found: "' + configPath +
      '" does not exist. Aborting.');
    process.exit(1);
  }

  var config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return config;
}

var config = loadConfig();

var log = new Logger({
  name: 'zapi',
  level: config.logLevel,
  serializers: {
    err: Logger.stdSerializers.err,
    req: Logger.stdSerializers.req,
    res: restify.bunyan.serializers.response
  }
});


/*
 * ZAPI constructor
 */
function ZAPI(options) {
  this.config = options;

  this.server = restify.createServer({
    name: 'Zones API',
    log: log
  });

  this.ufds = ldap.createClient({
    url: options.ufds.url,
    connectTimeout: options.ufds.connectTimeout * 1000
  });

  this.ufds.log4js.setGlobalLogLevel(config.logLevel);
}


/*
 * Inits a UFDS connection. Receives a callback as an argument. An error will
 * be the argument to the callback when the connection could not be established
 */
ZAPI.prototype.initUfds = function(callback) {
  log.trace({rootDn: this.config.ufds.rootDn}, 'bind to UFDS');

  this.ufds.bind(this.config.ufds.rootDn, this.config.ufds.password, function (err) {
    if (err) {
      callback(err);
    } else {
      callback(null);
    }
  });
}


/*
 * Sets custom middlewares to use for the API
 */
ZAPI.prototype.setMiddleware = function() {
  this.server.use(restify.bodyParser());
  this.server.use(restify.queryParser());
}


/*
 * Sets all routes for static content
 */
ZAPI.prototype.setStaticRoutes = function() {

  // TODO: static serve the docs, favicon, etc.
  //  waiting on https://github.com/mcavage/node-restify/issues/56 for this.
  this.server.get('/favicon.ico', function (req, res, next) {
      filed(__dirname + '/docs/media/img/favicon.ico').pipe(res);
      next();
  });
}


/*
 * Sets all routes for the ZAPI server
 */
ZAPI.prototype.setRoutes = function() {

  var before = [
    addProxies
  ];

  this.server.get({path: '/machines', name: 'ListMachines'}, before, machines.listMachines);
  this.server.get({path: '/machines/:uuid', name: 'GetMachine'}, before, machines.getMachine);
}


/*
 * Starts listening on the port given specified by config.api.port. Takes a
 * callback as an argument. The callback is called with no arguments
 */
ZAPI.prototype.listen = function(callback) {
  this.server.listen(this.config.api.port, '0.0.0.0', callback);
}


/*
 * Loads UFDS into the request chain
 */
function addProxies(req, res, next) {
  req.ufds = zapi.ufds;

  return next();
}


var zapi = new ZAPI(config);

zapi.initUfds(function(err) {

  if (err) {
    log.error(err, 'error connecting to UFDS. Aborting.');
    process.exit(1);
  }

  zapi.setMiddleware();
  zapi.setStaticRoutes();
  zapi.setRoutes();

  zapi.listen(function() {
    log.info({url: zapi.server.url}, '%s listening', zapi.server.name);
  });

});

