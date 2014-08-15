'use strict';

var _ = require('underscore');

function Queue(fbRoot, workerId, concurrency) {
  this.fbRoot      = fbRoot;
  this.fbQueue     = fbRoot.child('queue');
  this.workerId    = workerId;
  this.concurrency = concurrency;

  this.active = [];
}

Queue.prototype.add = function(commit) {
  var queueEntry = _.pick(commit, 'user', 'repo', 'sha');
  // If we have room, claim it immediately!
  if (this.active.length < this.concurrency) {
    this.process(commit);
    queueEntry.activeWorker = this.workerId;
  }
  // Note that there is potential for dupes; but it should be rare, and isn't
  // the end of the world when it occurs. We just run the same tests again.
  this.fbQueue.push(queueEntry);
};

Queue.prototype.process = function(commit) {

};

module.exports = Queue;
