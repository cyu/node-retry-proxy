var connect = require("connect");
var retryProxy = require("../");

var port = process.env.PORT || '8080';
var originHost = process.env.ORIGIN_HOST || '127.0.0.1';
var originPort = process.env.ORIGIN_PORT || '80';
var maxRetries = process.env.MAX_RETRIES || 5;

connect().
  use(retryProxy({
    hosts: [{
      host: originHost,
      port: originPort
    }],
    maxRetries: maxRetries,
    shouldRetry: function(originResponse, err) {
      return err || originResponse.statusCode == 500
    }
  })).
  listen(Number(port));

