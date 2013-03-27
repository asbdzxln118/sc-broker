var PORT = process.argv[2];
var SECRET_KEY = process.argv[3] || null;
var HOST = '127.0.0.1';

var initialized = {};

var com = require('ncom');
var FlexiMap = require('fleximap').FlexiMap;

var escapeStr = '\\u001b';
var escapeArr = escapeStr.split('');
var escapeRegex = /\\+u001b/g;

var dotSubRegex = /\\+u001a/g;

var unsimplifyFilter = function(str) {
	return str.replace(dotSubRegex, '.');
}

var unescapeFilter = function(str) {
	return str.replace(escapeRegex, '');
}

var filters = [unsimplifyFilter, unescapeFilter];

var send = function(socket, object) {
	socket.write(object, filters);
}

var DataMap = new FlexiMap();
var EventMap = new FlexiMap();

var addListener = function(socket, event) {
	EventMap.set('socket.' + socket.id + '.' + event, socket);
}

var hasListener = function(socket, event) {
	return EventMap.hasKey('socket.' + socket.id + '.' + event);
}

var anyHasListener = function(event) {
	var sockets = EventMap.get('socket');
	var i;
	for(i in sockets) {
		if(EventMap.hasKey('socket.' + i + '.' + event)) {
			return true;
		}
	}
	return false;
}

var removeListener = function(socket, event) {
	EventMap.remove('socket.' + socket.id + '.' + event);
}

var getListeners = function(socket) {
	return EventMap.get('socket.' + socket.id);
}

var removeAllListeners = function(socket) {
	EventMap.remove('socket.' + socket.id);
}

var escapeBackslashes = function(str) {
	return str.replace(/([^\\])\\([^\\])/g, '$1\\\\$2');
}
	
var validateQuery = function(str) {
	return /^ *function *\([^)]*\) *\{(\n|.)*\} *$/.test(str);
}

var run = function(code, context) {
	if(!validateQuery(code)) {
		throw "JavaScript query must be an anonymous function declaration";
	}
	
	var dataContext;
	if(context) {
		dataContext = DataMap.getRaw(context);
	} else {
		dataContext = DataMap;
	}
	
	return Function('return (' + escapeBackslashes(code) + ')(arguments[0], arguments[1]);')(dataContext, EventMap);
}

var countTreeLeaves = function(tree) {
	var i;
	var num = 0;
	for(i in tree) {
		if(EventMap.isIterable(tree[i])) {
			num += countTreeLeaves(tree[i]);
		} else {
			num++;
		}
	}
	return num;
}

var actions = {
	init: function(command, socket) {	
		var result = {id: command.id, type: 'response', action: 'init'};
		
		if(command.secretKey == SECRET_KEY) {
			initialized[socket.id] = true;
		} else if(SECRET_KEY) {
			result.error = 'nData Error - Invalid password was supplied to nData';
		}
		
		send(socket, result);
	},

	set: function(command, socket) {
		var result = DataMap.set(command.key, command.value);
		var response = {id: command.id, type: 'response', action: 'set'};
		if(command.getValue) {
			response.value = result;
		}
		send(socket, response);
	},
	
	get: function(command, socket) {
		var result = DataMap.get(command.key);
		send(socket, {id: command.id, type: 'response', action: 'get', value: result});
	},
	
	getRange: function(command, socket) {
		var result = DataMap.getRange(command.key, command.fromIndex, command.toIndex);
		send(socket, {id: command.id, type: 'response', action: 'getRange', value: result});
	},
	
	getAll: function(command, socket) {
		send(socket, {id: command.id, type: 'response', action: 'getAll', value: DataMap.getData()});
	},
	
	count: function(command, socket) {
		var result = DataMap.count(command.key);
		send(socket, {id: command.id, type: 'response', action: 'count', value: result});
	},
	
	add: function(command, socket) {
		var result = DataMap.add(command.key, command.value);
		var response = {id: command.id, type: 'response', action: 'add'};
		if(command.getValue) {
			response.value = result;
		}
		send(socket, response);
	},
	
	concat: function(command, socket) {
		var result = DataMap.concat(command.key, command.value);
		var response = {id: command.id, type: 'response', action: 'concat'};
		if(command.getValue) {
			response.value = result;
		}
		send(socket, response);
	},
	
	run: function(command, socket) {
		var ret = {id: command.id, type: 'response', action: 'run'};
		try {
			var result = run(command.value, command.context);
			ret.value = result;
		} catch(e) {
			if(e.stack) {
				e = e.stack;
			}
			ret.error = 'nData Error - Exception at run(): ' + e;
		}
		send(socket, ret);
	},
	
	remove: function(command, socket) {
		var result = DataMap.remove(command.key);
		var response = {id: command.id, type: 'response', action: 'remove'};
		if(command.getValue) {
			response.value = result;
		}
		send(socket, response);
	},
	
	removeRange: function(command, socket) {
		var result = DataMap.removeRange(command.key, command.fromIndex, command.toIndex);
		var response = {id: command.id, type: 'response', action: 'removeRange'};
		if(command.getValue) {
			response.value = result;
		}
		send(socket, response);
	},
	
	removeAll: function(command, socket) {
		DataMap.removeAll();
		send(socket, {id: command.id, type: 'response', action: 'removeAll'});
	},
	
	pop: function(command, socket) {
		var result = DataMap.pop(command.key);
		var response = {id: command.id, type: 'response', action: 'pop'};
		if(command.getValue) {
			response.value = result;
		}
		send(socket, response);
	},
	
	hasKey: function(command, socket) {
		send(socket, {id: command.id, type: 'response', action: 'hasKey', value: DataMap.hasKey(command.key)});
	},
	
	watch: function(command, socket) {
		addListener(socket, command.event);
		send(socket, {id: command.id, type: 'response', action: 'watch', event: command.event});
	},
	
	watchExclusive: function(command, socket) {
		var listening = anyHasListener(command.event);
		if(!listening) {
			addListener(socket, command.event);
		}
		send(socket, {id: command.id, type: 'response', action: 'watchExclusive', event: command.event, value: listening});
	},
	
	unwatch: function(command, socket) {
		if(command.event) {
			removeListener(socket, command.event);
		} else {
			removeAllListeners(socket);
		}
		
		send(socket, {id: command.id, type: 'response', action: 'unwatch', event: command.event});
	},
	
	isWatching: function(command, socket) {
		var result = EventMap.hasKey('socket.' + socket.id + '.' + command.event);
		send(socket, {id: command.id, type: 'response', action: 'isWatching', event: command.event});
	},
	
	broadcast: function(command, socket) {
		var sockets = EventMap.get('socket');
		var i, sock, eventString;
		for(i in sockets) {
			eventString = 'socket.' + i + '.' + command.event;
			if(EventMap.hasKey(eventString)) {
				sock = EventMap.get(eventString);
				if(sock instanceof com.ComSocket) {
					send(sock, {type: 'event', event: command.event, value: command.value});
				}
			}
		}
		send(socket, {id: command.id, type: 'response', action: 'broadcast', value: command.value, event: command.event});
	}
}

var MAX_ID = Math.pow(2, 53) - 2;
var curID = 1;

var genID = function() {
	curID++;
	curID = curID % MAX_ID;
	return curID;
}

var server = com.createServer();

var errorHandler = function(err) {
	if(err.stack) {
		console.log(err.stack);
	} else {
		console.log(err);
	}
}

server.listen(PORT, HOST);

var evaluate = function(str) {
	return Function('return ' + DataMap.escapeBackslashes(str) + ' || null;')();
}

var substitute = function(str) {
	return DataMap.get(str);
}

var convertToString = function(object) {
	var str;
	if(typeof object == 'string') {
		str = object;
	} else if(typeof object == 'number') {
		str = object;
	} else if(object == null) {
		str = null;
	} else if(object == undefined) {
		str = object;
	} else {
		str = object.toString();
	}
	return str;
}

var arrayToString = function(array) {
	if(array.length == 1) {
		return convertToString(array[0]);
	}
	var i;
	var str = '';
	for(i in array) {
		str += convertToString(array[i]);
	}
	return str;
}

var matchesPrev = function(charArray, beforeIndex, matchCharArray) {
	var i, j;
	for(i=beforeIndex-matchCharArray.length, j=0; i<beforeIndex; i++, j++) {
		if(!charArray[i] || charArray[i] != matchCharArray[j]) {
			return false;
		}
	}
	return true;
}

var compile = function(str, macroMap, macroName) {
	var buffer = [];
	var chars;
	if(typeof str == 'string') {
		chars = str.split('');
	} else {
		chars = str;
	}
	var len = chars.length;
	
	var i, j, curMacroChar, segment, numOpen, notEscaped, comp;
	for(i=0; i<len; i++) {
		if(macroMap.hasOwnProperty(chars[i]) && chars[i + 1] == '(') {
			curMacroChar = chars[i];
			i += 2;
			segment = [];
			numOpen = 1;
			for(j=i; j<len; j++) {
				notEscaped = !matchesPrev(chars, j, escapeArr);
				if(chars[j] == '(' && notEscaped) {
					numOpen++;
				} else if(chars[j] == ')' && notEscaped) {
					numOpen--;
				}
				
				if(numOpen > 0) {
					segment.push(chars[j]);
				} else {
					break;
				}
			}
			i = j;
			if(curMacroChar == '#') {
				comp = macroMap[curMacroChar](arrayToString(segment));
			} else {
				comp = compile(segment, macroMap, curMacroChar);
			}
			buffer.push(comp);
		} else {
			buffer.push(chars[i]);
		}
	}
	if(macroName) {
		return macroMap[macroName](arrayToString(buffer));
	} else {
		return arrayToString(buffer);
	}
}

var macros = {
	'%': evaluate,
	'$': substitute
};

server.on('connection', function(sock) {
	sock.id = genID();
	sock.on('message', function(command) {
		if(!SECRET_KEY || initialized.hasOwnProperty(sock.id) || command.action == 'init') {
			try {
				if(!command.key || typeof command.key == 'string') {
					if(command.key) {
						command.key = compile(command.key, macros);
					}
					if(command.value && typeof command.value == 'string') {
						command.value = compile(command.value, macros);
					}
					if(command.context) {
						command.context = compile(command.context, macros);
					}
					if(actions.hasOwnProperty(command.action)) {
						actions[command.action](command, sock);
					}
				} else {
					send(sock, {id: command.id, type: 'response', action: command.action, error: 'nData Error - The specified key was not a string'});
				}
			} catch(e) {
				if(e.stack) {
					console.log(e.stack);
				} else {
					console.log(e);
				}
				if(e instanceof Error) {
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
	
	sock.on('end', function() {
		if(initialized.hasOwnProperty(sock.id)) {
			delete initialized[sock.id];
		}
		removeAllListeners(sock);
	});
});

server.on('listening', function() {
	process.send({event: 'listening'});
});

process.on('uncaughtException', errorHandler);