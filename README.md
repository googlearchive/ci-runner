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

`node .`


Spinning Up Your Own Workers
----------------------------

The CI runner is intended to be run as a persistent server; and we provide
configuration to make that easy.


### Google Compute Engine

You can make use of the [`tools/gcloud/manage`](tools/gcloud/manage) script.
You will need to create a configuration file and place it somewhere handy:

```sh
# The Google Compute Engine project name.
GCLOUD_PROJECT=my-ci-project
# A GitHub OAuth token with repo:status permissions.
# See https://github.com/settings/applications
GITHUB_OAUTH_TOKEN=abcdef0123456789abcdef0123456789abcdef01
# Your Sauce Labs username.
SAUCE_USERNAME=username
# Your Sauce Labs access key.
SAUCE_ACCESS_KEY=abcdef01-abcd-abcd-abcd-abcdef012345
# The firebase app where webhook jobs should be stored.
FIREBASE_APP=my-firebase-app
```


### Heroku

TODO.


### EC2

TODO.


### Other Hosting Providers

TODO.
