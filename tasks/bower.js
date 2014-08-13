module.exports = function bower(grunt) {
  grunt.loadNpmTasks('grunt-bower-task');
  grunt.config.merge({
    bower: {
      install: {
        options: {
          copy: false,
        },
      },
    },
  });
};
