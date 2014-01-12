define([
    "editor",
    "ui/dialog",
    "ui/contextMenus",
    "command",
    "tab",
    "settings!ace,user",
    "ui/statusbar",
    "util/manos",
    "aceBindings"
  ],
  function(editor, dialog, contextMenus, command, Tab, Settings, status, M) {

  var tabs = [];
  var cfg = Settings.get("ace");
  var userConfig = Settings.get("user");
  var syntax = document.find(".syntax");
  var stack = [];
  var stackOffset = 0;

  var renderTabs = function() {
    var tabContainer = document.find(".tabs");
    var contents = "";
    var current = editor.getSession();
    tabContainer.innerHTML = "";
    tabs.forEach(function(tab, index) {
      var element = document.createElement("a");
      element.setAttribute("draggable", true);
      element.setAttribute("command", "session:raise-tab");
      element.setAttribute("argument", index);
      element.setAttribute("title", tab.fileName);
      element.setAttribute("href", "tabs/" + index);
      element.removeAttribute("title");
      element.className = "tab";
      if (tab === current) {
        element.addClass("active");
      }
      if (tab.animationClass) {
        element.addClass(tab.animationClass);
      }
      tab.animationClass = "";
      element.innerHTML = tab.fileName + (tab.modified ? " &bull;" : "");
      var close = document.createElement("a");
      close.innerHTML = "&times;";
      close.className = "close";
      close.setAttribute("command", "session:close-tab");
      close.setAttribute("argument", index);
      element.append(close);
      tabContainer.append(element);
    });
    setTimeout(function() {
      //wait for render before triggering the enter animation
      tabContainer.findAll(".enter").forEach(function(element) { element.removeClass("enter") });
    });
    setRetained();
  };

  command.on("session:render", renderTabs);

  var setRetained = function() {
    var keep = [];
    tabs.forEach(function(tab, i) {
      if (!tab.file || tab.file.virtual) return;
      keep[i] = tab.file.retain();
    });
    keep = keep.filter(function(m) { return m });
    if (keep.length) {
      chrome.storage.local.set({ retained: keep });
    }
  };

  var setTabSyntax = function(tab) {
    tab.setUseSoftTabs(!userConfig.useTabs);
    tab.setTabSize(userConfig.indentation || 2);
    tab.setUseWrapMode(userConfig.wordWrap);
    tab.setWrapLimit(userConfig.wrapLimit || null);
    tab.setNewLineMode(userConfig.lineEnding || "auto");
    tab.setUseWorker(userConfig.useWorker);
    var syntaxValue = "plain_text";
    if (tab.syntaxMode) {
      syntaxValue = tab.syntaxMode;
    } else if (tab.file) {
      if (tab.file.virtual) {
        //settings files are special
        syntaxValue = "javascript";
        tab.setMode("ace/mode/javascript");
      } else if (tab.file.entry) {
        var found = false;
        var extension = tab.file.entry.name.split(".").pop();
        for (var i = 0; i < cfg.modes.length; i++) {
          var mode = cfg.modes[i];
          if (mode.extensions.indexOf(extension) > -1) {
            tab.setMode("ace/mode/" + mode.name);
            syntaxValue = mode.name;
            break;
          }
        }
      }
      tab.syntaxMode = syntaxValue;
    }
    tab.setMode("ace/mode/" + syntaxValue);
    syntax.value = syntaxValue;
  };

  var addTab = function(contents, file) {
    var current = editor.getSession();
    var tab;
    //reuse tab if opening a file into an empty tab
    if (file && !current.file && !current.modified) {
      tab = current;
      tab.setValue(contents);
      tab.setFile(file);
      tab.modified = false;
    } else {
      tab = new Tab(contents, file);
      stack.unshift(tab);
      tabs.push(tab);
    }
    if (file && !file.virtual) {
      file.entry.file(function(f) {
        var loaded = ["Loaded ", f.name, ", ", f.size, " bytes"].join("");
        status.toast(loaded, 2);
      });
    }
    setTabSyntax(tab);
    raiseTab(tab);
    return tab;
  };

  var removeTab = function(index, c) {
    if (!index) {
      index = tabs.indexOf(editor.getSession());
    }
    var tab = tabs[index];
    stack = stack.filter(function(t) { return t !== tab });

    var continuation = function() {
      tab.drop();
      tabs = tabs.filter(function(tab, i) {
        if (i == index) {
          return false;
        }
        return true;
      });
      if (tabs.length == 0) {
        return addTab();
      }
      var next = index - 1;
      if (next < 0) {
        next = 0;
      }
      var current = editor.getSession();
      if (tab !== current) {
        renderTabs();
      } else {
        raiseTabByIndex(next);
      }
      if (c) c();
    };

    if (tab.modified) {
      dialog(
        tab.fileName + " has been modified.\nDo you want to save changes?",
        [
          {label: "Save", value: true, shortcut: "y" },
          {label: "Don't save", value: false, shortcut: "n" },
          { label: "Cancel", shortcut: "c" }
        ],
        function(confirm) {
          if (typeof confirm !== "boolean") {
            return;
          }
          if (confirm) {
            return tab.save(continuation);
          }
          continuation();
        });
        return;
    } else {
      continuation();
    }
  };

  var raiseTab = function(tab) {
    editor.setSession(tab);
    syntax.value = tab.syntaxMode || "plain_text";
    renderTabs();
    editor.focus();
    command.fire("session:check-file");
  };

  var raiseBlurred = function(tab) {
    editor.setSession(tab);
    syntax.value = tab.syntaxMode || "plain_text";
    renderTabs();
    command.fire("session:check-file");
  };

  var raiseTabByIndex = function(index) {
    var tab = tabs[index];
    raiseTab(tab);
  };

  var resetStack = function(tab) {
      var raised = tab || stack[stackOffset];
      stack = stack.filter(function(t) { return t != raised });
      stack.unshift(raised);
  }

  var watchCtrl = function(e) {
    if (e.keyCode == 17) {
      resetStack();
      document.body.off("keyup", watchCtrl);
      ctrl = false;
    }
  };

  var ctrl = false;

  var switchTab = function(arg, c) {
    arg = arg || 1;
    if (!ctrl) {
      ctrl = true;
      stackOffset = 0;
      document.body.on("keyup", watchCtrl);
    }
    stackOffset = (stackOffset + arg) % stack.length;
    if (stackOffset < 0) stackOffset = stack.length + stackOffset;
    raiseTab(stack[stackOffset]);
    if (c) c();
  };

  var switchTabLinear = function(shift, c) {
    shift = shift || 1;
    var current = editor.getSession();
    var currentIndex = tabs.indexOf(current);
    var shifted = (currentIndex + shift) % tabs.length;
    if (shifted < 0) {
      shifted = tabs.length + shifted;
    }
    var tab = tabs[shifted];
    raiseTab(tab);
    resetStack(tab);
    if (c) c();
  };

  command.on("session:raise-tab", function(index) {
    var tab = tabs[index];
    raiseTab(tab);
    resetStack(tab);
  });
  command.on("session:close-tab", removeTab);
  command.on("session:change-tab", switchTab);
  command.on("session:change-tab-linear", switchTabLinear);

  var enableTabDragDrop = function() {
    var tabContainer = document.find(".tabs");
    var draggedTab = null;
    tabContainer.on("dragstart", function(e) {
      if (!e.target.matches(".tab")) return;
      e.target.style.opacity = .4;
      setTimeout(function() {
        e.target.addClass("dragging");
      }, 50);
      e.dataTransfer.setDragImage(e.target, 0, 0);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.clearData("text/plain");
      e.dataTransfer.clearData("text/uri-list");
      e.dataTransfer.setData("application/x-tab-id", e.target.getAttribute("argument"));
      draggedTab = e.target;
      draggedTab.ondragend = function() {
        draggedTab = null;
        e.target.style.opacity = null;
        e.target.removeClass("dragging");
      };
    });
    tabContainer.on("dragover", function(e) {
      e.preventDefault();
      e.stopPropagation();
      e.dropEffect = "move";
    });
    tabContainer.on("dragenter", function(e) {
      if (!e.target.matches(".tab")) return;
      e.target.addClass("hovering");
      e.stopPropagation();
    });
    tabContainer.on("dragleave", function(e) {
      if (!e.target.matches(".tab")) return;
      e.target.removeClass("hovering");
    });
    tabContainer.on("drop", function(e) {
      if (!draggedTab) return;
      e.stopPropagation();
      var target = e.target;
      var location = "before";
      var x = e.offsetX;
      while (!target.matches(".tab")) {
        if (target == tabContainer) {
          var elements = tabContainer.findAll(".tab");
          location = "after";
          elements.forEach(function(el) {
            if (el.offsetLeft < x) {
              target = el;
            }
          });
          break;
        }
        target = target.parentElement;
        x += target.offsetLeft;
      }
      var from = tabs[e.dataTransfer.getData("application/x-tab-id") * 1];
      var onto = tabs[target.getAttribute("argument") * 1];
      if (from != onto) {
        var reordered = [];
        tabs.forEach(function(t) {
          if (t == from) return;
          if (t == onto && location == "before") {
            reordered.push(from);
          }
          reordered.push(t);
          if (t == onto && location == "after") {
            reordered.push(from);
          }
        });
        tabs = reordered;
      }
      renderTabs();
    });
  };
  
  var enableTabMiddleClick = function() {
    var tabContainer = document.find(".tabs");
    tabContainer.on("click", function(e) {
      if (!e.target.matches(".tab")) return;
      if (e.button != 1) return;
      e.preventDefault();
      command.fire("session:close-tab", e.target.getAttribute("argument"));
    });
  };

  var closeTabsRight = function(tabID) {
    tabID = tabID || tabs.indexOf(editor.getSession());
    var toClose = [];
    for (var i = tabs.length - 1; i > tabID; i--) {
      toClose.push(i);
    }
    M.serial(toClose, removeTab);
  };

  command.on("session:close-to-right", closeTabsRight);

  contextMenus.register("Close", "closeTab", "tabs/:id", function(args) {
    command.fire("session:close-tab", args.id);
  });
  contextMenus.register("Close tabs to the right", "closeTabsRight", "tabs/:id", function(args) {
    closeTabsRight(args.id);
  });

  var init = function() {
    cfg.modes.forEach(function(mode) {
      var option = document.createElement("option");
      option.innerHTML = mode.label;
      option.value = mode.name;
      syntax.append(option);
    });
    if (!tabs.length) addTab("");
    renderTabs();
    enableTabDragDrop();
    enableTabMiddleClick();
    reset();
    return "sessions";
  };

  var reset = function() {
    cfg = Settings.get("ace");
    userConfig = Settings.get("user");
    tabs.forEach(function(tab) {
      setTabSyntax(tab);
    })
  };

  command.on("init:startup", init);
  command.on("init:restart", reset);

  command.on("session:syntax", function(mode) {
    var session = editor.getSession();
    session.setMode("ace/mode/" + mode);
    session.syntaxMode = mode;
    syntax.value = mode;
    editor.focus();
  });


  var locationMemory = null;

  return {
    addFile: addTab,
    setSyntax: setTabSyntax,
    addDefaultsFile: function(name) {
      Settings.load(name, function() {
        var tab = addTab(Settings.getAsString(name, true));
        tab.syntaxMode = "javascript";
        setTabSyntax(tab);
        tab.fileName = name + ".json";
        renderTabs();
      });
    },
    getAllTabs: function() {
      return tabs;
    },
    getCurrent: function() {
      return editor.getSession();
    },
    getTabByIndex: function(index) {
      return tabs[index];
    },
    getTabByName: function(name) {
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].fileName == name) {
          return tabs[i];
        }
      }
      return null;
    },
    getFilenames: function() {
      return tabs.map(function(t) { return t.fileName });
    },
    setCurrent: raiseTab,
    raiseBlurred: raiseBlurred,
    saveLocation: function() {
      var session = editor.getSession();
      var position = editor.getCursorPosition();
      locationMemory = {
        tab: session,
        cursor: position
      };
    },
    restoreLocation: function() {
      if (!locationMemory) return;
      raiseTab(locationMemory.tab);
      editor.moveCursorToPosition(locationMemory.cursor);
    },
    renderTabs: renderTabs
  }

});