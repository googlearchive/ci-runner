
var Firebase = require('firebase');
var git = require('gift');
var GitHubApi = require('github');
var async = require('async');
var path = require('path');
var shelljs = require('shelljs');

shelljs.rm('-rf', 'commits');

var testsInProgress = {};
var fbChangeQueue = new Firebase('https://ci-runner.firebaseio.com/change_queue');

var github = new GitHubApi({
    version: "3.0.0",
    timeout: 5000
});

var token = process.env.GITHUB_OAUTH_TOKEN;

github.authenticate({
    type: 'oauth',
    token: token
});

fbChangeQueue.on('child_added', function(s) {
	testCommit(s.val(), s.ref());
});

function exec(cmd, args, callBack) {
    var spawn = require('child_process').spawn;
    var child = spawn(cmd, args);
    var resp = '';
    child.stdout.on('data', function (buffer) { resp += buffer.toString(); });
    child.stdout.on('end', function() { callBack (resp); });
}

function testCommit(event, fbRef) {
	var commit = event.pull_request.head;
	if (testsInProgress[commit.sha]) {
		return;
	}
	var user = event.repository.owner.login;
	var repoName = event.repository.name;
	var repoPath = path.join('commits', user + '.' + repoName + "." + commit.sha);
	var repo;
	testsInProgress[commit.sha] = true;
	async.series([
		function(next) {
			console.log('Clone:', commit.repo.clone_url);
			git.clone(commit.repo.clone_url, repoPath, function(err, _repo) {
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
			console.log('Setting status to "pending" for ' + commit.sha);
			github.statuses.create({
				user: user,
				repo: repoName,
				sha: commit.sha,
				state: 'pending',
				description: 'Your awesome test is running...'
			}, function(err) {
				next(err);
			});
		},
		function(next) {
			console.log('Starting test on ' + commit.sha);
			setTimeout(function() {
				console.log('Completed test on ' + commit.sha);
				next();
			}, 5000);
		},
		function(next) {
			console.log('Setting status to "success" for ' + commit.sha);
			github.statuses.create({
				user: user,
				repo: repoName,
				sha: commit.sha,
				state: 'success',
				description: 'Your awesome test is done!'
			}, function(err) {
				next(err);
			});
		},
		function(next) {
			shelljs.rm('-rf', repoPath);
			fbRef.remove();
			next();
		}
	], function(err) {
		testsInProgress[commit.sha] = false;
		if (err) {
			shelljs.rm('-rf', repoPath);
			console.log(err);
		}
	});
}