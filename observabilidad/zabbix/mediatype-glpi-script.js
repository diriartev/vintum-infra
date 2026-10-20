const CLogger = function(serviceName) {
	this.serviceName = serviceName;
	this.INFO = 4
	this.WARN = 3
	this.ERROR = 2
	this.log = function(level, msg) {
		Zabbix.log(level, '[' + this.serviceName + '] ' + msg);
	}
}

const CWebhook = function(value) {
	try {
		params = JSON.parse(value);

		if (['0', '1', '2', '3', '4'].indexOf(params.event_source) === -1) {
			throw 'Incorrect "event_source" parameter given: ' + params.event_source + '.\nMust be 0-4.';
		}

		if (['0', '3', '4'].indexOf(params.event_source) !== -1 && ['0', '1'].indexOf(params.event_value) === -1) {
			throw 'Incorrect "event_value" parameter given: ' + params.event_value + '.\nMust be 0 or 1.';
		}

		if (['0', '3', '4'].indexOf(params.event_source) !== -1) {
			if (params.event_source === '1' && ['0', '1', '2', '3'].indexOf(params.event_value) === -1) {
				throw 'Incorrect "event_value" parameter given: ' + params.event_value + '.\nMust be 0-3.';
			}

			if (params.event_source === '0' && ['0', '1'].indexOf(params.event_update_status) === -1) {
				throw 'Incorrect "event_update_status" parameter given: ' + params.event_update_status + '.\nMust be 0 or 1.';
			}

			if (params.event_source === '4') {
				if (['0', '1', '2', '3', '4', '5'].indexOf(params.event_update_nseverity) !== -1 && params.event_update_nseverity != params.event_nseverity) {
					params.event_nseverity = params.event_update_nseverity;
					params.event_severity = params.event_update_severity;
					params.event_update_status = '1';
				}
			}
		}

		this.runCallback = function(name, params) {
			if (typeof this[name] === 'function') {
				return this[name].apply(this, [params]);
			}
		}

		this.handleEvent = function(source, event) {
			const alert = { source: source, event: event };
			return [
				this.runCallback('on' + source + event, alert),
				this.runCallback('on' + event, alert),
				this.runCallback('onEvent', alert)
			];
		}

		this.handleEventless = function(source) {
			const alert = { source: source, event: null };
			return [
				this.runCallback('on' + source, alert),
				this.runCallback('onEvent', alert)
			];
		}

		this.run = function() {
			var results = [];
			if (typeof this.httpProxy === 'string' && this.httpProxy.trim() !== '') {
				this.request.setProxy(this.httpProxy);
			}
			const types = { '0': 'Trigger', '1': 'Discovery', '2': 'Autoreg', '3': 'Internal', '4': 'Service' };

			if (['0', '3', '4'].indexOf(this.params.event_source) !== -1) {
				var event = (this.params.event_update_status === '1')
					? 'Update'
					: ((this.params.event_value === '1') ? 'Problem' : 'Resolve');

				results = this.handleEvent(types[this.params.event_source], event);
			}
			else if (typeof types[this.params.event_source] !== 'undefined') {
				results = this.handleEventless(types[this.params.event_source]);
			}
			else {
				throw 'Unexpected "event_source": ' + this.params.event_source;
			}

			for (idx in results) {
				if (typeof results[idx] !== 'undefined') {
					return JSON.stringify(results[idx]);
				}
			}
		}
		this.httpProxy = params.http_proxy;
		this.params = params;
		this.runCallback('onCheckParams', {});
	} catch (error) {
		throw 'Webhook processing failed: ' + error;
	}
}

const CParamValidator = {

	isType: function(value, type) {
		if (type === 'array') {
			return Array.isArray(value);
		}
		if (type === 'integer') {
			return CParamValidator.isInteger(value);
		}
		if (type === 'float') {
			return CParamValidator.isFloat(value);
		}

		return (typeof value === type);
	},

	isInteger: function(value) {
		if (!CParamValidator.ifMatch(value, /^-?\d+$/)) {
			return false;
		}

		return !isNaN(parseInt(value));
	},

	isFloat: function(value) {
		if (!CParamValidator.ifMatch(value, /^-?\d+\.\d+$/)) {
			return false;
		}

		return !isNaN(parseFloat(value));
	},

	isDefined: function(value) {
		return !CParamValidator.isType(value, 'undefined');
	},

	isEmpty: function(value) {
		if (!CParamValidator.isType(value, 'string')) {
			throw 'Value "' + value + '" must be a string to be checked for emptiness.';
		}

		return (value.trim() === '');
	},

	isMacroSet: function(value, macro) {
		if (CParamValidator.isDefined(macro)) {
			return !(CParamValidator.ifMatch(value, '^\{' + macro + '\}$'))
		}

		return !(CParamValidator.ifMatch(value, '^\{[$#]{0,1}[A-Z_\.]+[\:]{0,1}["]{0,1}.*["]{0,1}\}$') || value === '*UNKNOWN*')
	},

	withinRange: function(value, min, max) {
		if (!CParamValidator.isType(value, 'number')) {
			throw 'Value "' + value + '" must be a number to be checked for range.';
		}
		if (value < ((CParamValidator.isDefined(min)) ? min : value)
			|| value > ((CParamValidator.isDefined(max)) ? max : value)) {
			return false;
		}

		return true;
	},

	inArray: function(value, array) {
		if (!CParamValidator.isType(array, 'array')) {
			throw 'The array must be an array to check the value for existing in it.';
		}

		return (array.indexOf((typeof value === 'string') ? value.toLowerCase() : value) !== -1);
	},

	ifMatch: function(value, regex) {
		return (new RegExp(regex)).test(value);
	},

	match: function(value, regex) {
		if (!CParamValidator.isType(value, 'string')) {
			throw 'Value "' + value + '" must be a string to be matched with the regular expression.';
		}

		return value.match(new RegExp(regex));
	},

	checkURL: function(value) {
		if (CParamValidator.isEmpty(value)) {
			throw 'URL value "' + value + '" must be a non-empty string.';
		}
		if (!CParamValidator.ifMatch(value, '^(http|https):\/\/.+')) {
			throw 'URL value "' + value + '" must contain a schema.';
		}

		return value.endsWith('/') ? value.slice(0, -1) : value;
	},

	check: function(key, rule, params) {
		if (!CParamValidator.isDefined(rule.type)) {
			throw 'Mandatory attribute "type" has not been defined for parameter "' + key + '".';
		}
		if (!CParamValidator.isDefined(params[key])) {
			throw 'Checked parameter "' + key + '" was not found in the list of input parameters.';
		}
		var value = params[key],
			error_message = null;
		switch (rule.type) {
			case 'string':
				if (!CParamValidator.isType(value, 'string')) {
					throw 'Value "' + key + '" must be a string.';
				}
				if (CParamValidator.isEmpty(value)) {
					error_message = 'Value "' + key + '" must be a non-empty string';
					break;
				}
				if (CParamValidator.isDefined(rule.len) && value.length < rule.len) {
					error_message = 'Value "' + key + '" must be a string with a length > ' + rule.len;
				}
				if (CParamValidator.isDefined(rule.regex) && !CParamValidator.ifMatch(value, rule.regex)) {
					error_message = 'Value "' + key + '" must match the regular expression "' + rule.regex + '"';
				}
				if (CParamValidator.isDefined(rule.url) && rule.url === true) {
					value = CParamValidator.checkURL(value);
				}
				break;
			case 'integer':
				if (!CParamValidator.isInteger(value)) {
					error_message = 'Value "' + key + '" must be an integer';
					break;
				}
				value = parseInt(value);
				break;
			case 'float':
				if (!CParamValidator.isFloat(value)) {
					error_message = 'Value "' + key + '" must be a floating-point number';
					break;
				}
				value = parseFloat(value);
				break;
			case 'boolean':
				if (CParamValidator.inArray(value, ['1', 'true', 'yes', 'on'])) {
					value = true;
				}
				else if (CParamValidator.inArray(value, ['0', 'false', 'no', 'off'])) {
					value = false;
				}
				else {
					error_message = 'Value "' + key + '" must be a boolean-like.';
				}
				break;
			case 'array':
				try {
					value = JSON.parse(value);
				} catch (error) {
					throw 'Value "' + key + '" contains invalid JSON.';
				}
				if (!CParamValidator.isType(value, 'array')) {
					error_message = 'Value "' + key + '" must be an array.';
				}
				if (CParamValidator.isDefined(rule.tags) && rule.tags === true) {
					value = value.reduce(function(acc, obj) {
						acc[obj.tag] = obj.value || null;
						return acc;
					}, {});
				}
				break;
			case 'object':
				value = JSON.parse(value);
				if (!CParamValidator.isType(value, 'object')) {
					error_message = 'Value "' + key + '" must be an object.';
				}
				break;
			default:
				throw 'Unexpected attribute type "' + rule.type + '" for value "' + key + '". Available: ' +
				['integer', 'float', 'string', 'boolean', 'array', 'object'].join(', ');
		}
		params[key] = value;
		if (CParamValidator.inArray(rule.type, ['integer', 'float']) && error_message === null && (CParamValidator.isDefined(rule.min)
			|| CParamValidator.isDefined(rule.max)) && !CParamValidator.withinRange(value, rule.min, rule.max)) {
			error_message = 'Value "' + key + '" must be a number ' + ((CParamValidator.isDefined(rule.min) && CParamValidator.isDefined(rule.max))
				? (rule.min + '..' + rule.max) : ((CParamValidator.isDefined(rule.min)) ? '>' + rule.min : '<' + rule.max));
		}
		else if (CParamValidator.isDefined(rule.array) && !CParamValidator.inArray(value, rule.array)) {
			error_message = 'Value "' + key + '" must be in the array ' + JSON.stringify(rule.array);
		}
		else if (CParamValidator.isDefined(rule.macro) && !CParamValidator.isMacroSet(value.toString(), rule.macro)) {
			error_message = 'The macro ' + ((CParamValidator.isDefined(rule.macro)) ? '{' + rule.macro + '} ' : ' ') + 'is not set';
		}
		if (error_message !== null) {
			if (CParamValidator.isDefined(rule.default) && CParamValidator.isType(rule.default, rule.type)) {
				params[key] = rule.default;
			}
			else {
				Zabbix.log(4, 'Default value for "' + key + '" must be a ' + rule.type + '. Skipped.');
				throw 'Incorrect value for variable "' + key + '". ' + error_message;
			}
		}

		return this;
	},

	validate: function(rules, params) {
		if (!CParamValidator.isType(params, 'object') || CParamValidator.isType(params, 'array')) {
			throw 'Incorrect parameters value. The value must be an object.';
		}
		for (var key in rules) {
			CParamValidator.check(key, rules[key], params);
		}
	}
}

const CHttpRequest = function(logger) {
	this.request = new HttpRequest();
	if (typeof logger !== 'object' || logger === null) {
		this.logger = Zabbix;
	}
	else {
		this.logger = logger;
	}

	this.clearHeader = function() {
		this.request.clearHeader();
	}

	this.addHeaders = function(value) {
		var headers = [];

		if (typeof value === 'object' && value !== null) {
			if (!Array.isArray(value)) {
				Object.keys(value).forEach(function(key) {
					headers.push(key + ': ' + value[key]);
				});
			}
			else {
				headers = value;
			}
		}
		else if (typeof value === 'string') {
			value.split('\r\n').forEach(function(header) {
				headers.push(header);
			});
		}

		for (var idx in headers) {
			this.request.addHeader(headers[idx]);
		}
	}

	this.setProxy = function(proxy) {
		this.request.setProxy(proxy);
	}

	this.plainRequest = function(method, url, data) {
		var resp = null;
		method = method.toLowerCase();
		this.logger.log(4, 'Sending ' + method + ' request:' + JSON.stringify(data));
		if (['get', 'post', 'put', 'patch', 'delete', 'trace'].indexOf(method) !== -1) {
			resp = this.request[method](url, data);
		}
		else if (['connect', 'head', 'options'].indexOf(method) !== -1) {
			resp = this.request[method](url);
		}
		else {
			throw 'Unexpected method. Method ' + method + ' is not supported.';
		}
		this.logger.log(4, 'Response has been received: ' + resp);

		return resp;
	}

	this.jsonRequest = function(method, url, data) {
		this.addHeaders('Content-Type: application/json');
		var resp = this.plainRequest(method, url, JSON.stringify(data));
		try {
			resp = JSON.parse(resp);
		}
		catch (error) {
			throw 'Failed to parse response: not well-formed JSON was received';
		}

		return resp;
	}

	this.getStatus = function() {
		return this.request.getStatus();
	}
}

const CWebhookHelper = {

	createProblemURL: function(event_source, zabbix_url, trigger_id, event_id) {
		if (event_source === '0') {
			return zabbix_url + '/tr_events.php?triggerid=' + trigger_id + '&eventid=' + event_id;
		} else if (event_source === '4') {
			return zabbix_url + '/zabbix.php?action=service.list';
		}

		return zabbix_url;
	},

};

var ZABBIX_SEVERITY_MAP = ["not_classified", "information", "warning", "average", "high", "disaster"];

var URGENCY_MAP = {
	"very low": 1,
	"low": 2,
	"medium": 3,
	"high": 4,
	"very high": 5
};

var LEGACY_ENDPOINT = '/apirest.php'
var CURRENT_ENDPOINT = '/api.php/v2.2'

const serviceLogName = 'GLPI Webhook',
	Logger = new CLogger(serviceLogName),
	GLPI = CWebhook;

GLPI.prototype.onCheckParams = function () {
	CParamValidator.validate({
		alert_message: { type: 'string' },
		alert_subject: { type: 'string' },
		zabbix_url: { type: 'string', url: true },
		glpi_url: { type: 'string', url: true },
		glpi_legacy_api: { type: 'boolean' },
		event_nseverity: { type: 'integer', default: 0 }
	}, this.params);

	if (this.params.glpi_legacy_api) {
		CParamValidator.validate({ glpi_user_token: { type: 'string' } }, this.params);

		this.params.use_app_token = false;

		if (CParamValidator.isDefined(this.params.glpi_app_token) && !CParamValidator.isEmpty(this.params.glpi_app_token)) {
			this.params.use_app_token = true;
		}
	} else {
		CParamValidator.validate({
			glpi_client_id: { type: 'string' },
			glpi_client_secret: { type: 'string' },
			glpi_username: { type: 'string' },
			glpi_password: { type: 'string' },
		}, this.params);
	}

	if (this.params.event_source === '0') {
		CParamValidator.validate({ trigger_id: { type: 'integer' }, event_id: { type: 'integer' } }, this.params);
		this.params.zabbix_url = CWebhookHelper.createProblemURL(this.params.event_source, this.params.zabbix_url, this.params.trigger_id, this.params.event_id);
	}

	if (params.event_value !== '0' && CParamValidator.isMacroSet(this.params.glpi_problem_id)) {
		this.params.event_update_status = '1';
	}

	this.urgency = this.params.event_source === 3
		? urgencyMapper(this.params.glpi_urgency_internal)
		: urgencyMapper(this.params['severity_' + ZABBIX_SEVERITY_MAP[this.params.event_nseverity]]);

	this.data = {
		name: this.params.alert_subject,
		urgency: this.urgency
	};

	this.dataFollowup = {
		items_id: this.params.glpi_problem_id,
		itemtype: 'Ticket',
		content: this.params.alert_message + '<br> <a href=' + this.params.zabbix_url + '>Link to problem in Zabbix</a>',
	};

	this.result = { tags: {} };
}

function urgencyMapper(urgency) {
	if (typeof urgency === "number") {
		return urgency;
	}

	if (typeof urgency !== "string") {
		throw 'Urgency must be a string or number. Got: ' + urgency + ' (typeof: ' + typeof urgency + ')';
	}

	var normalized = urgency.trim().toLowerCase();

	if (!URGENCY_MAP.hasOwnProperty(normalized)) {
		throw 'Unknown urgency value: ' + urgency;
	}

	return URGENCY_MAP[normalized];
}

function checkResponseStatus(status, response) {
	if (status !== 200 && status !== 201) {
		Logger.log(Logger.INFO, 'HTTP code: ' + status);

		if (CParamValidator.isType(response.description, 'string')) {
			throw response.description;
		} else {
			Logger.log(Logger.INFO, 'Request not successful. Received response: ' + JSON.stringify(response));
			throw 'Unknown INFO. Check debug log for more information.';
		}
	}
}

function wrapInput(data) {
	return { input: data };
}

GLPI.prototype.getAuthToken = function () {
	if (this.params.glpi_legacy_api) {
		this.request.addHeaders('Authorization: user_token ' + this.params.glpi_user_token);

		if (this.params.use_app_token) {
			this.request.addHeaders('App-Token: ' + this.params.glpi_app_token);
		}

		var response = this.request.jsonRequest('post', this.params.glpi_url + LEGACY_ENDPOINT + '/initSession');
	} else {
		var body = {
			grant_type: 'password',
			client_id: this.params.glpi_client_id,
			client_secret: this.params.glpi_client_secret,
			username: this.params.glpi_username,
			password: this.params.glpi_password,
			scope: 'api'
		};

		var response = this.request.jsonRequest('post', this.params.glpi_url + CURRENT_ENDPOINT + '/token', body);
	}

	checkResponseStatus(this.request.getStatus(), response);

	return response[this.params.glpi_legacy_api ? 'session_token' : 'access_token'];
}

GLPI.prototype.sendRequest = function (method, path, data) {
	this.request.clearHeader();

	if (this.params.glpi_legacy_api) {
		this.request.addHeaders('Session-Token:' + this.params.authToken);

		if (this.params.use_app_token) {
			this.request.addHeaders('App-Token: ' + this.params.glpi_app_token);
		}

	} else {
		this.request.addHeaders('Authorization: Bearer ' + this.params.authToken);
	}

	var response = this.request.jsonRequest(method, this.params.glpi_url + path, data);

	checkResponseStatus(this.request.getStatus(), response);

	return response;
}

GLPI.prototype.createProblem = function (status) {
	this.data.urgency = this.urgency;
	this.data.content = this.params.alert_message + '<br> <a href=' + this.params.zabbix_url + '>Link to problem in Zabbix</a>';

	if (CParamValidator.isDefined(status)) {
		this.data.status = status;
	}

	var api = this.params.glpi_legacy_api ?
		{url: LEGACY_ENDPOINT + '/Ticket/', data: wrapInput(this.data)} :
		{url: CURRENT_ENDPOINT + '/Assistance/Ticket/', data: this.data};

	var response = this.sendRequest('post', api.url, api.data);

	if (!CParamValidator.isDefined(response.id)) {
		throw 'Cannot create GPLi ticket. Check debug log for more information.';
	}

	return response.id;
}

GLPI.prototype.updateProblem = function (status) {
	CParamValidator.validate({ glpi_problem_id: { type: 'string' } }, this.params);

	if (CParamValidator.isDefined(status)) {
		this.data.status = status;
	}

	var api = this.params.glpi_legacy_api ? {
		url: LEGACY_ENDPOINT + '/Ticket/' + encodeURIComponent(this.params.glpi_problem_id),
		url2: LEGACY_ENDPOINT + '/Ticket/' + encodeURIComponent(this.params.glpi_problem_id) + '/ITILFollowup',
		data: wrapInput(this.data),
		dataFollowup: wrapInput(this.dataFollowup)
	} : {
		url: CURRENT_ENDPOINT + '/Assistance/Ticket/' + encodeURIComponent(this.params.glpi_problem_id),
		url2: CURRENT_ENDPOINT + '/Assistance/Ticket/' + encodeURIComponent(this.params.glpi_problem_id) + '/Timeline/Followup',
		data: this.data,
		dataFollowup: this.dataFollowup
	};

	api.data.id = this.params.glpi_problem_id;

	// Vintum (B2-36): primero el seguimiento y despues el cambio de estado.
	// Al reves, GLPI reabre el ticket: el seguimiento lo agrega el usuario
	// "zabbix", que es el solicitante (ParentStatus::needReopen()).
	this.sendRequest('post', api.url2, api.dataFollowup);
	this.sendRequest('patch', api.url, api.data);
}

GLPI.prototype.onProblem = function (alert) {
	Logger.log(Logger.INFO, 'Source: ' + alert.source + '; Event: ' + alert.event);
	const problem_id = this.createProblem(1)

	this.result.tags.__zbx_glpi_problem_id = problem_id;
	this.result.tags.__zbx_glpi_link = this.params.glpi_url + '/front/ticket.form.php?id=' + problem_id;

	return this.result;
}

GLPI.prototype.onUpdate = function (alert) {
	Logger.log(Logger.INFO, 'Source: ' + alert.source + '; Event: ' + alert.event);
	this.updateProblem();

	return this.result;
}

GLPI.prototype.onResolve = function (alert) {
	Logger.log(Logger.INFO, 'Source: ' + alert.source + '; Event: ' + alert.event);
	this.updateProblem(5);

	return this.result;
}

GLPI.prototype.onDiscovery = function (alert) {
	Logger.log(Logger.INFO, 'Source: ' + alert.source);
	this.urgency = urgencyMapper(this.params.glpi_urgency_discovery);

	return this.createProblem();
}

GLPI.prototype.onAutoreg = function (alert) {
	Logger.log(Logger.INFO, 'Source: ' + alert.source);
	this.urgency = urgencyMapper(this.params.glpi_urgency_autoregistration);

	return this.createProblem();
}

try {
	var hook = new GLPI(value);
	hook.request = new CHttpRequest(Logger);
	hook.params.authToken = hook.getAuthToken();
	return hook.run();
}
catch (error) {
	Logger.log(Logger.WARN, 'notification failed: ' + error);
	throw 'Sending failed: ' + error;
}
