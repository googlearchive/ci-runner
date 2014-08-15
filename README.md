Polymer CI Runner
=================

A quick 'n dirty Node app that pulls GitHub webhook events off of a
[Firebase](https://www.firebase.com/) queue and runs the appropriate set of
tests for them.


Configuring The Webhook
-----------------------

Through the joys of Firebase, you can have GitHub webhooks publish directly to
it. Create a new webhook:

`https://<your-firebase-app>.firebaseio.com/queue.json`

You will want to turn on pull request and push status.


Running Locally
---------------

`node server`


Spinning Up Your Own Workers
----------------------------

The CI runner is intended to be run as a persistent server. The worker is published as a [Docker image](https://registry.hub.docker.com/u/polymerlabs/ci-runner/)
that you can use; and we provide configuration to make that easy.


### Google Compute Engine

You can make use of the [`tools/gcloud/manage`](tools/gcloud/manage) script.
You will need to create a `.polymer-ci-runner.sh` and place it somewhere handy:

```sh
# The Google Compute Engine project name.
export GCLOUD_PROJECT=my-ci-project

# Number of concurrent test runs.
export CONCURRENCY=10

# OAuth token used when posting statuses/comments to GitHub.
# See https://github.com/settings/applications
export GITHUB_OAUTH_TOKEN=abcdef0123456789abcdef0123456789abcdef01
# URL path to accept GitHub webhooks on.
export GITHUB_WEBHOOK_PATH=/github
# The secret registered for the webhook; invalid requests will be rejected.
export GITHUB_WEBHOOK_SECRET=abcdef0123456789abcdef0123456789abcdef01
# A whitelist of refs that pushes are accepted for.
export VALID_PUSH_REFS=refs/heads/master

# Your Sauce Labs username.
export SAUCE_USERNAME=username
# Your Sauce Labs access key.
export SAUCE_ACCESS_KEY=abcdef01-abcd-abcd-abcd-abcdef012345

# The Firebase URL where queue entries and run statuses are stored under.
export FIREBASE_ROOT=https://my-firebase-app.firebaseio.com
```

You can then run `manage` from any directory that contains that config file
directly, or up its path.


### Heroku

TODO.


### EC2

TODO.


### Other Hosting Providers

TODO.
