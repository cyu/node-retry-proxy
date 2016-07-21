'use strict';

var net = require('net'),
    http = require('http'),
    debug = require('debug');

var error = debug("retry-proxy:error");
var log   = debug("retry-proxy:log");

function delayFor(attempt, maxDelay) {
  var result = 1000 * Math.pow(attempt, 2);
  if (maxDelay) {
    result = Math.min(result, maxDelay);
  }
  return result;
}

function neverRetryDefaultStrategy(originResponse, err) {
  return false;
}

module.exports = function retryProxy(options) {
  var shouldRetry, maxBackoff, maxRetries, allHosts;

  options = options || {};
  shouldRetry = options.shouldRetry || neverRetryDefaultStrategy;
  allHosts = options.hosts || [];

  if (options.maxBackoff) maxBackoff = options.maxBackoff;
  if (options.maxRetries) maxRetries = options.maxRetries;

  return function retryProxy(req, res, next) {
    var reqBuffer = null;
    var attempt = 0;
    var hosts = allHosts.slice();
    var nextHost = null;

    function finishRequest(proxyResponse) {
      res.writeHead(proxyResponse.statusCode, proxyResponse.headers);
      proxyResponse.pipe(res);
    }

    function attemptRetry() {
      var delay = delayFor(attempt, maxBackoff);
      var allowRetry =  true;

      ++attempt;

      if (maxBackoff) allowRetry = (delay < maxBackoff);
      if (maxRetries) allowRetry = (attempt < maxRetries);

      setTimeout(function() {
        nextHost = hosts.shift();
        hosts.push(nextHost);
        log("retrying: %o", {retry: attempt, url: req.url, host: nextHost});
        doProxy(nextHost, allowRetry);
      }, delay);
    }

    function doProxy(host, retryable) {
      var proxyRequest = http.request({
        method: req.method,
        port: host.port,
        host: host.host,
        path: req.url,
        headers: req.headers
      });

      proxyRequest.
        on('error', function(err) {
          error('socket error: %s %o', err.message, {retry: attempt, url: req.url, host: host.host});
          if (retryable && shouldRetry(null, err)) {
            attemptRetry();
          } else {
            res.writeHead(500, {'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(err.message)});
            res.write(err.message);
            res.end();
          }
        }).
        on('response', function(proxyResponse) {
          if (retryable && shouldRetry(proxyResponse, null)) {
            attemptRetry();
          } else {
            finishRequest(proxyResponse);
          }
        });

      if (reqBuffer == null) {
        var data = [];
        req.
          on('data', function(chunk) {
            data.push(chunk);
          }).
          on('end', function() {
            reqBuffer = Buffer.concat(data);
            proxyRequest.write(reqBuffer);
            proxyRequest.end();
          });
      } else {
        proxyRequest.write(reqBuffer);
        proxyRequest.end();
      }
    }

    nextHost = hosts.shift();
    hosts.push(nextHost);
    doProxy(nextHost, true);
  }
}

