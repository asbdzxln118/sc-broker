var PORT = parseInt(process.argv[2]);
var SECRET_KEY = process.argv[3] || null;
var EXPIRY_ACCURACY = process.argv[4] || 1000;
var STORE_CONTROLLER_PATH = process.argv[5] || null;

var STORE_CONTROLLER = null;
if (STORE_CONTROLLER_PATH) {
  STORE_CONTROLLER = require(STORE_CONTROLLER_PATH);
}

var EventEmitter = require('events').EventEmitter;

var initialized = {};

var domain = require('domain');
var com = require('ncom');
var ExpiryManager = require('expirymanager').ExpiryManager;
var FlexiMap = require('fleximap').FlexiMap;

var errorHandler = function (err) {
  var error;

  if (err.stack) {
    error = {
      message: err.message,
      stack: err.stack
    };
  } else {
    error = err;
  }

  process.send({event: 'error', data: error});
};

var errorDomain = domain.create();
errorDomain.on('error', errorHandler);

var escapeStr = '\\u001b';
var escapeArr = escapeStr.split('');

var send = function (socket, object) {
  socket.write(object);
};

var dataMap = new FlexiMap();
var channelMap = new FlexiMap();

var dataExpirer = new ExpiryManager();

var addListener = function (socket, channel) {
  channelMap.set(['sockets', socket.id].concat(channel), socket);
};

var hasListener = function (socket, channel) {
  return channelMap.hasKey(['sockets', socket.id].concat(channel));
};

var anyHasListener = function (channel) {
  var sockets = channelMap.get('sockets');
  for (var i in sockets) {
    if (channelMap.hasKey(['sockets', i].concat(channel))) {
      return true;
    }
  }
  return false;
};

var removeListener = function (socket, channel) {
  channelMap.remove(['sockets', socket.id].concat(channel));
};

var removeAllListeners = function (socket) {
  channelMap.remove(['sockets', socket.id]);
};

var getListeners = function (socket) {
  return channelMap.get(['sockets', socket.id]);
};

var run = function (query, baseKey) {
  var rebasedDataMap;
  if (baseKey) {
    rebasedDataMap = dataMap.getRaw(baseKey);
  } else {
    rebasedDataMap = dataMap;
  }

  return Function('"use strict"; return (' + query + ')(arguments[0], arguments[1], arguments[2]);')(rebasedDataMap, dataExpirer, channelMap);
};


var Store = function () {
  EventEmitter.call(this);
};

Store.prototype = Object.create(EventEmitter.prototype);

Store.prototype.set = function (key, value) {
  return dataMap.set(key, value);
};

Store.prototype.expire = function (keys, value) {
  dataExpirer.expire(keys, value);
};

Store.prototype.unexpire = function (keys) {
  dataExpirer.unexpire(keys);
};

Store.prototype.getExpiry = function (key) {
  return dataExpirer.getExpiry(key);
};

Store.prototype.get = function (key) {
  return dataMap.get(key);
};

Store.prototype.getRange = function (key, fromIndex, toIndex) {
  return dataMap.getRange(key, fromIndex, toIndex);
};

Store.prototype.getAll = function () {
  return dataMap.getAll();
};

Store.prototype.count = function (key) {
  return dataMap.count(key);
};

Store.prototype.add = function (key, value) {
  return dataMap.add(key, value);
};

Store.prototype.concat = function (key, value) {
  return dataMap.concat(key, value);
};

Store.prototype.run = function (query, baseKey) {
  return run(query, baseKey);
};

Store.prototype.remove = function (key) {
  return dataMap.remove(key);
};

Store.prototype.removeRange = function (key, fromIndex, toIndex) {
  return dataMap.removeRange(key, fromIndex, toIndex);
};

Store.prototype.removeAll = function () {
  dataMap.removeAll();
};

Store.prototype.pop = function (key) {
  return dataMap.pop(key);
};

Store.prototype.hasKey = function (key) {
  return dataMap.hasKey(key);
};

Store.prototype.publish = function (channel, message) {
  var sockets = channelMap.get('sockets');
  var sock, channelKey;
  for (var i in sockets) {
    channelKey = ['sockets', i].concat(channel);
    if (channelMap.hasKey(channelKey)) {
      sock = channelMap.get(channelKey);
      if (sock instanceof com.ComSocket) {
        send(sock, {type: 'message', channel: channel, value: message});
      }
    }
  }
};

var nDataStore = new Store();

if (STORE_CONTROLLER) {
  errorDomain.run(function () {
    STORE_CONTROLLER.run(nDataStore);
  });
}
errorDomain.add(nDataStore);

var actions = {
  init: function (command, socket) {
    var result = {id: command.id, type: 'response', action: 'init'};
    if (command.secretKey == SECRET_KEY || !SECRET_KEY) {
      initialized[socket.id] = {};
    } else {
      result.error = 'nData Error - Invalid password was supplied to nData';
    }
    send(socket, result);
  },

  set: function (command, socket) {
    var result = nDataStore.set(command.key, command.value);
    var response = {id: command.id, type: 'response', action: 'set'};
    if (command.getValue) {
      response.value = result;
    }
    send(socket, response);
  },

  expire: function (command, socket) {
    nDataStore.expire(command.keys, command.value);
    var response = {id: command.id, type: 'response', action: 'expire'};
    send(socket, response);
  },

  unexpire: function (command, socket) {
    nDataStore.unexpire(command.keys);
    var response = {id: command.id, type: 'response', action: 'unexpire'};
    send(socket, response);
  },

  getExpiry: function (command, socket) {
    var response = {id: command.id, type: 'response', action: 'getExpiry', value: nDataStore.getExpiry(command.key)};
    send(socket, response);
  },

  get: function (command, socket) {
    var result = nDataStore.get(command.key);
    send(socket, {id: command.id, type: 'response', action: 'get', value: result});
  },

  getRange: function (command, socket) {
    var result = nDataStore.getRange(command.key, command.fromIndex, command.toIndex);
    send(socket, {id: command.id, type: 'response', action: 'getRange', value: result});
  },

  getAll: function (command, socket) {
    send(socket, {id: command.id, type: 'response', action: 'getAll', value: nDataStore.getAll()});
  },

  count: function (command, socket) {
    var result = nDataStore.count(command.key);
    send(socket, {id: command.id, type: 'response', action: 'count', value: result});
  },

  add: function (command, socket) {
    var result = nDataStore.add(command.key, command.value);
    var response = {id: command.id, type: 'response', action: 'add'};
    if (command.getValue) {
      response.value = result;
    }
    send(socket, response);
  },

  concat: function (command, socket) {
    var result = nDataStore.concat(command.key, command.value);
    var response = {id: command.id, type: 'response', action: 'concat'};
    if (command.getValue) {
      response.value = result;
    }
    send(socket, response);
  },

  registerDeathQuery: function (command, socket) {
    var response = {id: command.id, type: 'response', action: 'registerDeathQuery'};

    if (initialized[socket.id]) {
      initialized[socket.id].deathQuery = command.value;
    }
    send(socket, response);
  },

  run: function (command, socket) {
    var ret = {id: command.id, type: 'response', action: 'run'};
    try {
      var result = nDataStore.run(command.value, command.baseKey);
      if (result !== undefined) {
        ret.value = result;
      }
    } catch(e) {
      if (e.stack) {
        e = e.stack;
      }
      ret.error = 'nData Error - Exception at run(): ' + e;
    }
    if (!command.noAck) {
      send(socket, ret);
    }
  },

  remove: function (command, socket) {
    var result = nDataStore.remove(command.key);
    if (!command.noAck) {
      var response = {id: command.id, type: 'response', action: 'remove'};
      if (command.getValue) {
        response.value = result;
      }
      send(socket, response);
    }
  },

  removeRange: function (command, socket) {
    var result = nDataStore.removeRange(command.key, command.fromIndex, command.toIndex);
    if (!command.noAck) {
      var response = {id: command.id, type: 'response', action: 'removeRange'};
      if (command.getValue) {
        response.value = result;
      }
      send(socket, response);
    }
  },

  removeAll: function (command, socket) {
    nDataStore.removeAll();
    if (!command.noAck) {
      send(socket, {id: command.id, type: 'response', action: 'removeAll'});
    }
  },

  pop: function (command, socket) {
    var result = nDataStore.pop(command.key);
    if (!command.noAck) {
      var response = {id: command.id, type: 'response', action: 'pop'};
      if (command.getValue) {
        response.value = result;
      }
      send(socket, response);
    }
  },

  hasKey: function (command, socket) {
    send(socket, {id: command.id, type: 'response', action: 'hasKey', value: nDataStore.hasKey(command.key)});
  },
  
  subscribe: function (command, socket) {
    addListener(socket, command.channel);
    nDataStore.emit('subscribe', command.channel);
    send(socket, {id: command.id, type: 'response', action: 'subscribe', channel: command.channel});
  },

  unsubscribe: function (command, socket) {
    if (command.channel) {
      removeListener(socket, command.channel);
    } else {
      removeAllListeners(socket);
    }
    nDataStore.emit('unsubscribe', command.channel);
    send(socket, {id: command.id, type: 'response', action: 'unsubscribe', channel: command.channel});
  },

  isSubscribed: function (command, socket) {
    var result = channelMap.hasKey(['sockets', socket.id, command.channel]);
    send(socket, {id: command.id, type: 'response', action: 'isSubscribed', channel: command.channel, value: result});
  },

  publish: function (command, socket) {
    nDataStore.publish(command.channel, command.value);
    var response = {id: command.id, type: 'response', action: 'publish', channel: command.channel};
    if (command.getValue) {
      response.value = command.value;
    }
    send(socket, response);
  }
};

var MAX_ID = Math.pow(2, 53) - 2;
var curID = 1;

var genID = function () {
  curID++;
  curID = curID % MAX_ID;
  return curID;
};

var server = com.createServer();

var handleConnection = errorDomain.bind(function (sock) {
  errorDomain.add(sock);
  sock.id = genID();
  sock.on('message', function (command) {
    if (!SECRET_KEY || initialized.hasOwnProperty(sock.id) || command.action == 'init') {
      try {
        if (actions[command.action]) {
          actions[command.action](command, sock);
        }
      } catch(e) {
        if (e.stack) {
          console.log(e.stack);
        } else {
          console.log(e);
        }
        if (e instanceof Error) {
          e = e.toString();
        }
        send(sock, {id: command.id, type: 'response', action:  command.action, error: 'nData Error - Failed to process command due to the following error: ' + e});
      }
    } else {
      var e = 'nData Error - Cannot process command before init handshake';
      console.log(e);
      send(sock, {id: command.id, type: 'response', action: command.action, error: e});
    }
  });

  sock.on('close', function () {
    if (initialized[sock.id]) {
      if (initialized[sock.id].deathQuery) {
        run(initialized[sock.id].deathQuery);
      }
      delete initialized[sock.id];
    }
    removeAllListeners(sock);
    errorDomain.remove(sock);
  });
});

errorDomain.add(server);
server.on('connection', handleConnection);

server.on('listening', function () {
  process.send({event: 'listening'});
});

server.listen(PORT);

setInterval(function () {
  var keys = dataExpirer.extractExpiredKeys();
  for (var i in keys) {
    dataMap.remove(keys[i]);
  }
}, EXPIRY_ACCURACY);