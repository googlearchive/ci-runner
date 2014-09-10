var handlebars = require('handlebars');
var stacky     = require('stacky');

function passthrough(string) {
  return string;
}

handlebars.registerHelper('prettyStack', function(context, options) {
  return stacky.pretty(context, {
    locationStrip: [
      /^https?:\/\/[^\/]+\//,
    ],
    unimportantLocation: [
      /^polymer-test-tools\//,
    ],
    methodPlaceholder: '[unknown]',
    styles: {
      method:      passthrough,
      location:    passthrough,
      line:        passthrough,
      column:      passthrough,
      unimportant: function(string) {
        return '<span style="color: #999999">' + string + '</span>'
      },
    }
  });
});

handlebars.registerHelper('prettyTest', function(context, options) {
  return (context || '<unknown test>').join(' » ');
});

handlebars.registerHelper('prettyBrowser', function(context, options) {
  return context.inspect();
});
