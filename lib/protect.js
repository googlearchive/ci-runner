'use strict';

var domain = require('domain');

function protect(task, onError) {
  var taskDomain = domain.create();
  taskDomain.on('error', onError);

  try {
    taskDomain.run(task);
  } catch(error) {
    onError(error);
  }
}

module.exports = protect;
