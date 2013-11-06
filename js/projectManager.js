define([
  "settings!",
  "command",
  "sessions",
  "file",
  "manos",
  "dom2"
  ], function(Settings, command, sessions, File, M) {
    
  /*
  It's tempting to store projects in local storage, similar to the way that we retain files for tabs, but this would be a mistake. Reading from storage is a pain, because it wants to store a single level deep, and we'll want to alter parts of the setup individually.
  
  Instead, we'll retain a single file handle to the project file, which (as JSON) will store the IDs of individual directories, the project-specific settings, and (hopefully, one day) build systems. This also gets us around the issues of restored directory order and constantly updating the retained file list--we'll just update it when the project file is saved.
  
  TODO:
  1. Get open directories, navigation, etc working.
  2. Enable project file generation, loading, restoration
  3. Allow projects to create a settings layer
  */

  var guidCounter = 0;

  //FSNodes are used to track filesystem state inside projects
  var FSNode = function(entry) {
    this.children = [];
    this.id = guidCounter++;
    if (entry) this.setEntry(entry);
  };
  FSNode.prototype = {
    isDirectory: false,
    entry: null,
    tab: null,
    id: null,
    label: null,
    setEntry: function(entry, c) {
      this.entry = entry;
      this.label = entry.name;
      this.isDirectory = entry.isDirectory;
    },
    walk: function(done) {
      var self = this;
      var entries = [];
      var reader = this.entry.createReader();
      var inc = 1;
      var check = function() {
        inc--;
        if (inc == 0) {
          return done(self);
        }
      };
      var collect = function(list) {
        if (list.length == 0) return complete();
        entries.push.apply(entries, list);
        reader.readEntries(collect);
      };
      var complete = function() {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (entry.name[0] == "." && entry.isDirectory) continue;
          var node = new FSNode(entry);
          self.children.push(node);
          if (node.isDirectory) {
            inc++;
            node.walk(check);
          }
        }
        check();
      };
      reader.readEntries(collect);
    }
  };
  
  var ProjectManager = function(element) {
    this.directories = [];
    this.pathMap = {};
    this.expanded = {};
    this.projectFile = null;
    if (element) {
      this.setElement(element)
    }
  };
  ProjectManager.prototype = {
    element: null,
    addDirectory: function(c) {
      var self = this;
      chrome.fileSystem.chooseEntry({ type: "openDirectory" }, function(d) {
        var root = new FSNode(d);
        self.directories.push(root);
        root.walk(self.render.bind(self));
      });
    },
    removeAllDirectories: function() {
      this.directories = [];
      this.render();
    },
    refresh: function() {
      var counter = 0;
      var self = this;
      var check = function() {
        counter++;
        if (counter = self.directories.length) {
          self.render();
        }
      }
      this.directories.forEach(function(d) {
        d.walk(check);
      });
    },
    render: function() {
      if (!this.element) return;
      this.element.innerHTML = "";
      if (this.directories.length == 0) {
        this.element.removeClass("show");
        return;
      }
      var self = this;
      this.element.addClass("show");
      this.pathMap = {};
      var walker = function(node) {
        var li = document.createElement("li");
        if (node.isDirectory) {
          li.innerHTML = node.label;
          li.setAttribute("data-full-path", node.entry.fullPath);
          li.addClass("directory");
          if (self.expanded[node.entry.fullPath]) {
            li.addClass("expanded");
          }
          var ul = document.createElement("ul");
          node.children.sort(function(a, b) {
            if (a.isDirectory != b.isDirectory) {
              //sneaky casting trick
              return b.isDirectory * 1 - a.isDirectory * 1;
            }
            if (a.label < b.label) return -1;
            if (a.label > b.label) return 1;
            return 0;
          });
          for (var i = 0; i < node.children.length; i++) {
            ul.append(walker(node.children[i]));
          }
          li.append(ul);
        } else {
          var path = node.entry.fullPath;
          var a = document.createElement("a");
          a.innerHTML = node.label;
          li.append(a);
          a.setAttribute("argument", path);
          a.setAttribute("command", "project:open-file");
          self.pathMap[path] = node;
        }
        return li;
      };
      var trees = this.directories.map(walker);
      var list = document.createElement("ul");
      trees.forEach(function(dir) {
        dir.classList.add("expanded");
        list.appendChild(dir);
      });
      this.element.appendChild(list);
    },
    setElement: function(el) {
      this.element = el;
      this.bindEvents();
    },
    bindEvents: function() {
      var self = this;
      this.element.on("click", function(e) {
        var target = e.target;
        if (target.hasClass("directory")) {
          target.toggle("expanded");
          var path = target.getAttribute("data-full-path");
          self.expanded[path] = !!!self.expanded[path]; 
        }
      });
    },
    openFile: function(path) {
      var self = this;
      //walk through existing tabs to see if it's already open
      var tabs = sessions.getAllTabs();
      var found = tabs.some(function(tab) {
        if (tab.file && tab.file.entry && tab.file.entry.fullPath == path) {
          sessions.setCurrent(tab);
          return true;
        }
      });
      if (found) return;
      //otherwise, we open the file and create a new tab
      var node = this.pathMap[path];
      if (!node) return;
      var file = new File(node.entry);
      file.read(function(err, data) {
        var tab = sessions.addFile(data, file);
      })
    },
    openProjectFile: function() {
      //read project file on user request
      //call setProject with contents
    },
    restoreProject: function() {
      //check local storage for retained project file ID
      //if exists and is valid, restore this file, then call setProject
    },
    setProject: function(project) {
      //project is the JSON from a project file
      //assign settings
      //restore directory entries that can be restored
    }
  };
  
  var pm = new ProjectManager(document.find(".project"));
  command.on("project:add-dir", pm.addDirectory.bind(pm));
  command.on("project:remove-all", pm.removeAllDirectories.bind(pm));
  command.on("project:open-file", pm.openFile.bind(pm));
  command.on("project:refresh-dir", pm.refresh.bind(pm));

});