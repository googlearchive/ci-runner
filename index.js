var Firebase = require('firebase');
var git = require('gift');
var GitHubApi = require('github');
var async = require('async');
var path = require('path');
var shelljs = require('shelljs');
var request = require('request');
var os = require('os');
var tmp = require('tmp');

var Commit = require('./lib/commit');
var exec   = require('./lib/exec');
var Log    = require('./lib/log');

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
  var commit, needsComment;

  // https://developer.github.com/v3/activity/events/types/#pullrequestevent
  if (event.pull_request) {
    var head = event.pull_request.head;
    commit = new Commit(head.user.login, head.repo.name, head.sha);
    needsComment = false;

  // https://developer.github.com/v3/activity/events/types/#pushevent
  } else if (event.head_commit) {
    // Only for master so that we avoid double-testing commits to pull request
    // branches; and we assume that other branches are less critical.
    //
    // TODO(nevir): Branches should be configurable.
    if (event.ref === 'refs/heads/master') {
      var repo = event.repository;
      commit = new Commit(repo.owner.name, repo.name, event.head_commit.id);
      needsComment = true;
    }

  } else {
    console.log('unknown event type', event);
    return;
  }

  if (commit) {
    testCommit(commit, needsComment, snapshot.ref());
  } else {
    snapshot.ref().remove(); // Not an error; we treat it as processed.
  }
}

function testCommit(commit, needsComment, fbRef) {
  var statusRef = fbChangeStatus.child(commit.key);
  statusRef.remove(); // Clean up prior state just in case.
  var log = new Log(process.stdout, commit, statusRef.child('log'));
  log.info('Starting test run');

  var repoPath;
  var statusUrl = 'http://polymerlabs.github.io/ci-runner/?firebase_app=' + FIREBASE_APP + '&commitKey=' + commit.key;
  var repo;
  var state;
  var statusMsg;
  var totalTests = 0;
  var passedTests = 0;
  var failedTests = 0;
  async.series([
    function(next) {
      tmp.dir(function(err, path) {
        if (err) return next(err);
        log.info('Working within', path);
        repoPath = path;
        next();
      });
    },
    function(next) {
      log.group('Fetching');
      log.info('Setting status to "pending"');
      statusRef.child('pending').set(true);
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
      log.info('Cloning', commit.repoUrl);
      git.clone(commit.repoUrl, repoPath, function(err, _repo) {
        repo = _repo;
        next(err);
      });
    },
    function(next) {
      log.info('Checking out', commit.sha);
      repo.checkout(commit.sha, function(err) {
        log.groupEnd();
        next(err);
      });
    },
    function(next) {
      log.group('Testing');
      var lastStatus = {};
      exec(log, 'npm', ['install'], repoPath, function(error) {
        if (!error) {
          github.statuses.create({
            user: commit.user,
            repo: commit.repo,
            sha: commit.sha,
            state: 'pending',
            description: 'Starting tests...',
            target_url: statusUrl
          });
          exec(log, 'grunt', [], repoPath, function(error) {
            if (error) {
              state = 'failure';
              statusMsg = failedTests + '/' + totalTests + ' platforms failed.';
            } else {
              state = 'success';
              statusMsg = passedTests + '/' + totalTests + ' platforms passed.';
            }
            next();
          }, function(data) {
            var match;
            if (match = data.match('(\\d*) tests started')) {
              totalTests = parseInt(match[1]);
              statusRef.child('total').set(totalTests);
            }
            if (match = data.match('Platform: (.*)')) {
              lastStatus.platform = match[1];
            }
            if (match = data.match('Passed: (.*)')) {
              lastStatus.passed = (match[1] == 'true');
              if (lastStatus.passed) {
                passedTests++;
                statusRef.child('passed').set(passedTests);
              } else {
                failedTests++;
                statusRef.child('failed').set(failedTests);
              }
            }
            if (match = data.match('Url (.*)')) {
              lastStatus.url = match[1];
              log.info(lastStatus);
              var fbStatus = statusRef.child('platforms').push(lastStatus);
              var jobId = (match = lastStatus.url.match('jobs/(.*)')) && match[1];
              updateWithLog(log, fbStatus, jobId);
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
      log.info('Setting status to ' + state + ' for ' + commit.sha);
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
    statusRef.child('pending').set(false);
    shelljs.rm('-rf', repoPath);
    if (err) {
      log.error(err);
      statusRef.child('error').set(err.toString());
      github.statuses.create({
        user: commit.user,
        repo: commit.repo,
        sha: commit.sha,
        state: 'error',
        description: 'Error occurred: ' + err
      });
      if (needsComment) {
        github.repos.createCommitComment({
          user: commit.user,
          repo: commit.repo,
          sha: commit.sha,
          commit_id: commit.sha, // Err what?
          body: '[Test Failure](' + statusUrl + '):\n---\n' + err,
        });
      }
    } else {
      fbRef.remove();
    }
  });
}

function urlForSauceResource(resource) {
  return 'https://' + SAUCE_USERNAME + ':' + SAUCE_ACCESS_KEY + '@saucelabs.com/rest/v1/' + SAUCE_USERNAME + resource;
}

function updateWithLog(log, fbStatus, jobId) {
  var url = urlForSauceResource('/jobs/' + jobId + '/assets/log.json');
  request.get(url, function(err, resp, body) {
    if (!err && resp.statusCode == 200) {
      var payload;
      try {
        payload = JSON.parse(body);
      } catch (e) {
        log.error('Invalid log JSON: ' + url, e);
        log.error(body);
        return;
      }
      log.info('Storing log for ' + jobId);
      fbStatus.child('log').set(body);
      for (var i=0; i<log.length; i++) {
        var s = payload[i];
        if (s.result && s.result.reports) {
          fbStatus.child('reports').set(s.result.reports);
          if (s.screenshot) {
            var n = ('0000' + s.screenshot).slice(-4);
            url = urlForSauceResource('/jobs/' + jobId + '/assets/' + n + 'screenshot.png');
            log.info('Retrieving image for ' + jobId);
            request.get({url:url, encoding:null}, function(err, resp, body) {
              if (!err && resp.statusCode == 200) {
                var data = "data:image/png;base64," + new Buffer(body).toString('base64');
                log.info('Storing image for ' + jobId);
                fbStatus.child('image').set(data);
              } else {
                log.error('Error retrieving image: ' + url + ': ' + err);
              }
            });
          }
          return;
        }
      }
    } else {
      log.error('Error retrieving log: ' + url + ': ' + err);
    }
  });
}

// var test = new Firebase('https://ci-runner.firebaseio.com/status/PolymerLabs-sauce-element-441a7b2bec399ec6c5b1c3b55531f125a7a086b2/-JU2tPns1mYVr8lXn1Dd');
// updateWithLog(test, '657f7d10fceb4e4aaa68de9dc0cfb536');
