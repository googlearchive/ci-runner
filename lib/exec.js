'use strict';

var spawn = require('child_process').spawn;

function exec(log, cmd, args, cwd, exitCB, dataCB, errCB) {
  var child = spawn(cmd, args, {cwd: cwd});
  log.group.apply(log, ['running command:', cmd].concat(args));

  onEachLine(child.stdout, function(line) {
    log.info(line);
    if (dataCB) dataCB(line);
  });
  onEachLine(child.stderr, function(line) {
    log.error(line);
    if (errCB) errCB(line);
  });

  var ended = false;
  function done(error) {
    if (ended) return;
    ended = true;
    log.groupEnd();
    exitCB(error);
  }

  child.on('exit', function(code, signal) {
    log.info('exit status', code, signal);
    done(code === 0 ? null : code);
  });
  child.on('error', function(error) {
    log.error('error', error);
    done(error);
  });
}

function onEachLine(stream, callback) {
  var buffer = '';
  stream.on('data', function(data) {
    buffer = buffer + data.toString();
    var index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      callback(buffer.slice(0, index)); // No newline.
      buffer = buffer.slice(index + 1);
    }
  });

  stream.on('close', function() {
    if (buffer !== '') callback(buffer);
  });
}

module.exports = exec;
