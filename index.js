
var Firebase = require('firebase');
var git = require('gift');
var GitHubApi = require('github');
var async = require('async');
var path = require('path');
var shelljs = require('shelljs');
var request = require('request');
var os = require('os');

var Commit = require('./lib/commit');

shelljs.rm('-rf', 'commits');

var github = new GitHubApi({
  version: "3.0.0",
  timeout: 5000
});

var FIREBASE_APP = process.env.FIREBASE_APP;
var GITHUB_OAUTH_TOKEN = process.env.GITHUB_OAUTH_TOKEN;
var SAUCE_USERNAME = process.env.SAUCE_USERNAME;
var SAUCE_ACCESS_KEY = process.env.SAUCE_ACCESS_KEY;
var FIREBASE_ROOT = 'https://' + FIREBASE_APP + '.firebaseio.com';

var fbChangeQueue = new Firebase(FIREBASE_ROOT + '/queue');
var fbChangeStatus = new Firebase(FIREBASE_ROOT + '/status');

github.authenticate({
  type: 'oauth',
  token: GITHUB_OAUTH_TOKEN
});

fbChangeQueue.on('child_added', onWebhookEventAdded);

function exec(cmd, args, cwd, exitCB, dataCB, errCB) {
  var spawn = require('child_process').spawn;
  var child = spawn(cmd, args, {cwd: cwd});
  var resp = '';
  if (dataCB) {
    child.stdout.on('data', function (buffer) {
      if (dataCB === true) {
        console.log(buffer.toString());
      } else {
        dataCB(buffer.toString());
      }
    });
  }
  if (errCB) {
    child.stderr.on('data', function (buffer) {
      if (errCB === true) {
        console.error(buffer.toString());
      } else {
        errCB(buffer.toString());
      }
    });
  }
  if (exitCB) {
    child.on('exit', function(code, signal) {
      exitCB(code);
    });
    child.on('error', function() {
      exitCB(-1);
    });
  }
}

function onWebhookEventAdded(snapshot) {
  snapshot.ref().transaction(function(event) {
    if (event._activeWorker) return; // Abort.
    event._activeWorker = os.hostname();
    return event;
  }, function(error, committed, snapshot) {
    if (error || !committed) {
      console.log(snapshot.name(), 'is already being processed by', snapshot.val()._activeWorker);
    } else {
      // TODO(nevir): Handle 'rollback' on failure.
      processEvent(snapshot);
    }
  });
}

function processEvent(snapshot, callback) {
  var event = snapshot.val();
  var commit;

  // https://developer.github.com/v3/activity/events/types/#pullrequestevent
  if (event.pull_request) {
    var head = event.pull_request.head;
    commit = new Commit(head.user.login, head.repo.name, head.sha);
  // https://developer.github.com/v3/activity/events/types/#pushevent
  } else if (event.head_commit) {
    commit = new Commit(event.repository.owner.name, event.repository.name, event.head_commit.id);
  }

  if (commit) {
    testCommit(commit, event, snapshot.ref());
  } else {
    console.log('unknown event type', event);
    snapshot.remove(); // Not an error; we treat it as processed.
  }
}

function testCommit(commit, event, fbRef) {
  console.log('testing', commit);
  var repoPath = path.join('commits', commit.pathPart);
  var statusUrl = 'http://polymerlabs.github.io/ci-runner/?firebase_app=' + FIREBASE_APP + '&commit=' + commit.key;
  var repo;
  var state;
  var statusMsg;
  var totalTests = 0;
  var passedTests = 0;
  var failedTests = 0;
  async.series([
    function(next) {
      console.log('Setting status to "pending" for ' + commit.sha);
      fbChangeStatus.child(commit.key).remove();
      fbChangeStatus.child(commit.key).child('pending').set(true);
      github.statuses.create({
        user: commit.user,
        repo: commit.repo,
        sha: commit.sha,
        state: 'pending',
        description: 'Initializing tests...',
        target_url: statusUrl
      }, function(err) {
        next(err);
      });
    },
    function(next) {
      console.log('Clone:', commit.repoUrl);
      git.clone(commit.repoUrl, repoPath, function(err, _repo) {
        repo = _repo;
        next(err);
      });
    },
    function(next) {
      console.log('Checkout:', commit.sha);
      repo.checkout(commit.sha, function(err) {
        next(err);
      });
    },
    function(next) {
      console.log('Starting test on ' + commit.sha);
      var lastStatus = {};
      console.log('Starting npm install');
      exec('npm', ['install'], repoPath, function(code) {
        console.log('Completed npm install with code ' + code);
        if (code === 0) {
          github.statuses.create({
            user: commit.user,
            repo: commit.repo,
            sha: commit.sha,
            state: 'pending',
            description: 'Starting tests...',
            target_url: statusUrl
          });
          exec('grunt', [], repoPath, function(code) {
            console.log('Completed grunt with code ' + code);
            if (code === 0) {
              state = 'success';
              statusMsg = passedTests + '/' + totalTests + ' platforms passed.';
            } else {
              state = 'failure';
              statusMsg = failedTests + '/' + totalTests + ' platforms failed.';
            }
            next();
          }, function(data) {
            var match;
            if (match = data.match('(\\d*) tests started')) {
              totalTests = parseInt(match[1]);
              fbChangeStatus.child(commit.key).child('total').set(totalTests);
            }
            if (match = data.match('Platform: (.*)')) {
              lastStatus.platform = match[1];
            }
            if (match = data.match('Passed: (.*)')) {
              lastStatus.passed = (match[1] == 'true');
              if (lastStatus.passed) {
                passedTests++;
                fbChangeStatus.child(commit.key).child('passed').set(passedTests);
              } else {
                failedTests++;
                fbChangeStatus.child(commit.key).child('failed').set(failedTests);
              }
            }
            if (match = data.match('Url (.*)')) {
              lastStatus.url = match[1];
              console.log(lastStatus);
              var fbStatus = fbChangeStatus.child(commit.key).child('platforms').push(lastStatus);
              var jobId = (match = lastStatus.url.match('jobs/(.*)')) && match[1];
              updateWithLog(fbStatus, jobId);
              github.statuses.create({
                user: commit.user,
                repo: commit.repo,
                sha: commit.sha,
                state: 'pending',
                description: 'Testing platforms: ' + passedTests + ' passed, ' + failedTests + ' failed, ' + (totalTests - passedTests - failedTests) + ' remaining...',
                target_url: statusUrl
              });
            }
          });
        } else {
          next('npm install failed');
        }
      });
    },
    function(next) {
      console.log('Setting status to ' + state + ' for ' + commit.sha);
      github.statuses.create({
        user: commit.user,
        repo: commit.repo,
        sha: commit.sha,
        state: state,
        description: statusMsg,
        target_url: statusUrl
      }, function(err) {
        next(err);
      });
    },
  ], function(err) {
    fbChangeStatus.child(commit.key).child('pending').set(false);
    shelljs.rm('-rf', repoPath);
    if (err) {
      console.error(err);
      fbChangeStatus.child(commit.key).child('error').set(err.toString());
      github.statuses.create({
        user: commit.user,
        repo: commit.repo,
        sha: commit.sha,
        state: 'error',
        description: 'Error occurred: ' + err
      });
    } else {
      fbRef.remove();
    }
  });
}

function urlForSauceResource(resource) {
  return 'https://' + SAUCE_USERNAME + ':' + SAUCE_ACCESS_KEY + '@saucelabs.com/rest/v1/' + SAUCE_USERNAME + resource;
}

function updateWithLog(fbStatus, jobId) {
  var url = urlForSauceResource('/jobs/' + jobId + '/assets/log.json');
  request.get(url, function(err, resp, body) {
    if (!err && resp.statusCode == 200) {
      var log;
      try {
        log = JSON.parse(body);
      } catch (e) {
        console.error('Invalid log JSON: ' + url, e);
        console.error(body);
        return;
      }
      console.log('Storing log for ' + jobId);
      fbStatus.child('log').set(body);
      for (var i=0; i<log.length; i++) {
        var s = log[i];
        if (s.result && s.result.reports) {
          fbStatus.child('reports').set(s.result.reports);
          if (s.screenshot) {
            var n = ('0000' + s.screenshot).slice(-4);
            url = urlForSauceResource('/jobs/' + jobId + '/assets/' + n + 'screenshot.png');
            console.log('Retrieving image for ' + jobId);
            request.get({url:url, encoding:null}, function(err, resp, body) {
              if (!err && resp.statusCode == 200) {
                var data = "data:image/png;base64," + new Buffer(body).toString('base64');
                console.log('Storing image for ' + jobId);
                fbStatus.child('image').set(data);
              } else {
                console.error('Error retrieving image: ' + url + ': ' + err);
              }
            });
          }
          return;
        }
      }
    } else {
      console.error('Error retrieving log: ' + url + ': ' + err);
    }
  });
}

// var test = new Firebase('https://ci-runner.firebaseio.com/status/PolymerLabs-sauce-element-441a7b2bec399ec6c5b1c3b55531f125a7a086b2/-JU2tPns1mYVr8lXn1Dd');
// updateWithLog(test, '657f7d10fceb4e4aaa68de9dc0cfb536');
