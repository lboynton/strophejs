// Check for the name of the naturaldocs binary
var fs = require('fs');
if (fs.existsSync("/usr/bin/naturaldocs")) {
    naturaldocs = "/usr/bin/naturaldocs";
} else if (fs.existsSync("/usr/lib/bin/natural_docs")) {
    naturaldocs = "/usr/lib/bin/natural_docs";
} else {
    naturaldocs = "NaturalDocs";
}

module.exports = function(grunt){
    var pkg = grunt.file.readJSON('package.json');

    grunt.initConfig({
        pkg: pkg,

        clean: {
            "prepare-doc": ["<%= natural_docs.docs.inputs[0] %>", "<%= natural_docs.docs.project %>"],
            "doc": ["<%= natural_docs.docs.output %>"],
            "prepare-release": ["strophejs-<%= pkg.version %>"],
            "release": ["strophejs-<%= pkg.version %>.zip", "strophejs-<%= pkg.version %>.tar.gz"],
            "js": ["<%= concat.dist.dest %>", "strophe.min.js"]
        },

        concat: {
            dist: {
                src: [
                    'src/base64.js', "src/sha1.js", "src/md5.js", "src/core.js", "src/build.js",
                    "src/pres.js", "src/iq.js", "src/msg.js", "src/request.js",
                    "src/bosh.js", "src/connection.js", "src/websocket.js", "src/sasl.js"
                ],
                dest: '<%= pkg.name %>'
            },
            options: {
                process: function(src){
                    return src.replace('@VERSION@', pkg.version);
                }
            }
        },

        copy: {
            "prepare-release": {
                files:[
                    {
                        expand: true,
                        src:['<%= concat.dist.dest %>', 'strophe.min.js', 'LICENSE.txt', 'README.txt',
                            'contrib/**', 'examples/**', 'plugins/**', 'tests/**', 'doc/**'],
                        dest:"strophejs-<%= pkg.version %>"
                    }
                ]
            },
            "prepare-doc": {
                files:[
                    {
                        src:['<%= concat.dist.dest %>'],
                        dest:"<%= natural_docs.docs.inputs[0] %>"
                    }
                ]
            }
        },

        jshint: {
            files: ['Gruntfile.js', 'src/*.js'],
        },

        shell: {
            tar: {
                command: 'tar czf strophejs-<%= pkg.version %>.tar.gz strophejs-<%= pkg.version %>',
                options: { failOnError: true }
            },
            zip: {
                command: 'zip -qr strophejs-<%= pkg.version %>.zip strophejs-<%= pkg.version %>',
                options: { failOnError: true }
            }
        },

        uglify: {
            options: {
                banner: '/*! <%= pkg.name %> v<%= pkg.version %> - built on <%= grunt.template.today("dd-mm-yyyy") %> */\n'
            },
            dist: {
                files: { 'strophe.min.js': ['<%= concat.dist.dest %>'] }
            }
        },

        watch: {
            files: ['<%= jshint.files %>'],
            tasks: ['concat', 'uglify']
        },

        natural_docs: {
            docs: {
                bin: naturaldocs,
                inputs: [ "doc-tmp/" ],
                project: "ndproj",
                output: "doc"
            },
        },

        mkdir: {
            "prepare-doc": {
                options: {
                    create: ["<%= natural_docs.docs.project %>", "<%= natural_docs.docs.output %>"]
                }
            },
        },
    });

    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.loadNpmTasks("grunt-contrib-uglify");
    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-contrib-watch');
    grunt.loadNpmTasks("grunt-contrib-concat");
    grunt.loadNpmTasks("grunt-contrib-clean");
    grunt.loadNpmTasks('grunt-shell');
    grunt.loadNpmTasks('grunt-natural-docs');
    grunt.loadNpmTasks('grunt-mkdir');

    grunt.registerTask("default", ["jshint", "min"]);
    grunt.registerTask("min", ["concat", "uglify"]);
    grunt.registerTask("prepare-release", ["copy:prepare-release"]);
    grunt.registerTask("doc", ["concat", "copy:prepare-doc", "mkdir:prepare-doc", "natural_docs"]);
    grunt.registerTask("release", ["default", "doc", "copy:prepare-release", "shell:tar", "shell:zip"]);
    grunt.registerTask("all", ["release", "clean"]);

};
