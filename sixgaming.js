var pjson = require("./package.json"),
    settings = require("./settings"),
    db = require("./database"),
    messageParse = /^!([^ ]+)(?: +(.+[^ ]))? *$/,
    codeParse = /^[1-9][0-9]{2}$/,
    userParse = /^([^#]+)#([1-9][0-9]+)$/,
    addGameParse = /^([a-zA-Z0-9]{2,50}) +(.{2,255})$/,
    nicks = {},
    sixIsLive = false,
    streamers = [],
    hosts = [],
    live = [],
    channelDeletionTimeouts = {},
    userChannels = {},
    channelCounts = {},
    userCreatedChannels = {},
    autoCommandRotation = [
        "facebook",
        "twitter",
        "youtube",
        "itunes",
        "discord"
    ],
    commandRotationWait = 5,
    commandRotationTimeout = 0,
    nextCheckHost = 0,
    secondaryChangeHost = 0,
    currentHost = "",
    manualHosting = false,
    irc, discord, twitch, sixDiscord, sixBotGGChannel, liveStreamAnnouncementsChannel, streamersRole;

SixGaming = {};

SixGaming.start = function(_irc, _discord, _twitch) {
    irc = _irc;
    discord = _discord;
    twitch = _twitch;

    var startup = function() {
        db.query("select streamer from streamer where validated = 1; select streamer from host", {}, function(err, data) {
            var readied = false,

                checkHosting = function() {
                    var hosted = false,
                        index = 0,
                        hostedIndex = -1,

                        tryHosting = function() {
                            if (streamers.length === 0) {
                                index = 0;
                                hostedIndex = -1;
                                trySecondaryHosting();
                                return;
                            }

                            twitch.getChannelStream(streamers[index], function(err, results) {
                                var streamerIndex;

                                if (!hosted && nextCheckHost <= 0) {
                                    if (!err && results && results.stream && !results.stream.is_playlist) {
                                        hosted = true;
                                    }

                                    nextCheckHost = 0;

                                    if (hosted) {
                                        if (currentHost !== streamers[index]) {
                                            currentHost = streamers[index];
                                            hostedIndex = index;
                                            SixGaming.ircQueue("Now hosting Six Gamer " + currentHost + ".  Check out their stream at http://twitch.tv/" + currentHost + "!");
                                            SixGaming.ircQueue("/host " + currentHost);
                                        }
                                        nextCheckHost = 10;
                                        secondaryChangeHost = 0;
                                    }
                                }

                                streamerIndex = live.indexOf(streamers[index]);
                                if (!err && results && results.stream && !results.stream.is_playlist) {
                                    if (streamerIndex === -1) {
                                        live.push(streamers[index]);
                                        if (results.stream.game) {
                                            SixGaming.discordQueue("@everyone - Six Gamer " + streamers[index] + " just went live on Twitch with \"" + results.stream.game + "\": \"" + results.stream.channel.status + "\"  Watch at http://twitch.tv/" + streamers[index], liveStreamAnnouncementsChannel);
                                        } else {
                                            SixGaming.discordQueue("@everyone - Six Gamer " + streamers[index] + " just went live on Twitch: \"" + results.stream.channel.status + "\"  Watch at http://twitch.tv/" + streamers[index], liveStreamAnnouncementsChannel);
                                        }
                                    }
                                } else {
                                    if (streamerIndex !== -1) {
                                        live.splice(streamerIndex, 1);
                                    }
                                }

                                index++;
                                if (index < streamers.length) {
                                    tryHosting();
                                } else {
                                    index = 0;
                                    if (hostedIndex !== -1) {
                                        streamers.splice(hostedIndex, 1);
                                        streamers.push(currentHost);
                                    }
                                    hostedIndex = -1;
                                    trySecondaryHosting();
                                }
                            });
                        },

                        trySecondaryHosting = function() {
                            var hostIndex;

                            if (hosts.length === 0) {
                                if (!hosted) {
                                    currentHost = "";
                                }
                                setTimeout(checkSixIsLive, 60000);
                                return;
                            }

                            twitch.getChannelStream(hosts[index], function(err, results) {
                                if (!hosted && secondaryChangeHost <= 0) {
                                    if (!err && results && results.stream && !results.stream.is_playlist) {
                                        hosted = true;
                                    }

                                    nextCheckHost = 0;

                                    if (hosted) {
                                        if (currentHost !== hosts[index]) {
                                            currentHost = hosts[index];
                                            hostedIndex = index;
                                            SixGaming.ircQueue("Now hosting " + currentHost + ".  Check out their stream at http://twitch.tv/" + currentHost + "!");
                                            SixGaming.ircQueue("/host " + currentHost);
                                        }
                                        nextCheckHost = 10;
                                        secondaryChangeHost = 60;
                                    }
                                }

                                hostIndex = live.indexOf(hosts[index]);
                                if (!err && results && results.stream && !results.stream.is_playlist) {
                                    if (hostIndex === -1) {
                                        live.push(hosts[index]);
                                        if (results.stream.game) {
                                            SixGaming.discordQueue(hosts[index] + " just went live on Twitch with \"" + results.stream.game + "\": \"" + results.stream.channel.status + "\"  Watch at http://twitch.tv/" + hosts[index], liveStreamAnnouncementsChannel);
                                        } else {
                                            SixGaming.discordQueue(hosts[index] + " just went live on Twitch: \"" + results.stream.channel.status + "\"  Watch at http://twitch.tv/" + hosts[index], liveStreamAnnouncementsChannel);
                                        }
                                    }
                                } else {
                                    if (hostIndex !== -1) {
                                        live.splice(hostIndex, 1);
                                    }
                                }

                                index++;
                                if (index < hosts.length) {
                                    trySecondaryHosting();
                                    return;
                                }

                                if (!hosted) {
                                    currentHost = "";
                                }

                                if (hostedIndex !== -1) {
                                    hosts.splice(hostedIndex, 1);
                                    hosts.push(currentHost);
                                }

                                setTimeout(checkSixIsLive, 60000);
                            });
                        };

                    tryHosting();
                },

                checkSixIsLive = function() {
                    twitch.getChannelStream("sixgaminggg", function(err, results) {
                        var sixWasLive = sixIsLive;
                        sixIsLive = !err && results && results.stream;
                        if (sixIsLive && currentHost) {
                            currentHost = "";
                            manualHosting = false;
                            nextCheckHost = 0;
                            secondaryChangeHost = 0;
                        }
                        if (!sixWasLive && sixIsLive) {
                            SixGaming.ircQueue("/unhost");
                            SixGaming.ircQueue("What's going on everyone? Six Gaming is live!");
                            discord.setStreaming(results.stream.channel.status, "http://twitch.tv/SixGamingGG", 1);
                        }
                        if (sixWasLive && !sixIsLive) {
                            discord.setStatus("online", null);
                        }

                        if (manualHosting && currentHost !== "") {
                            twitch.getChannelStream(currentHost, function(err, results) {
                                manualHosting = !err && results && results.stream;
                                if (!manualHosting) {
                                    checkHosting();
                                } else {
                                    setTimeout(checkSixIsLive, 60000);
                                }
                            });
                        } else {
                            nextCheckHost--;
                            secondaryChangeHost--;
                            if (!sixIsLive && !manualHosting) {
                                checkHosting();
                            } else {
                                setTimeout(checkSixIsLive, 60000);
                            }
                        }
                    });
                },

                ircConnect = function() {
                    irc.connect(function() {
                        irc.send("/raw CAP REQ :twitch.tv/membership");

                        irc.join("#sixgaminggg");
                    });
                },

                discordConnect = function() {
                    discord.loginWithToken(settings.discord.token, function(err) {
                        if (err) {
                            discord.logout(discordConnect);
                        }
                    });
                };

            if (err) {
                setTimeout(startup, 60000);
                return;
            }

            streamers = data[0].map(function(streamer) {return streamer.streamer;});
            hosts = data[1].map(function(streamer) {return streamer.streamer;});

            /*
             irc.addListener("raw", function(message) {
             // console.log(message);
             });
             */

            irc.addListener("error", function(message) {
                console.log("ERROR", message);
                irc.disconnect(ircConnect);
            });

            irc.addListener("abort", function(message) {
                console.log("ABORT", message);
                irc.disconnect(ircConnect);
            });

            irc.addListener("netError", function(message) {
                console.log("NETERROR", message);
                irc.disconnect(ircConnect);
            });

            irc.addListener("message#sixgaminggg", function(from, text) {
                SixGaming.ircMessage(from, text);
            });

            irc.addListener("names#sixgaminggg", function(nicks) {
                SixGaming.names(nicks);
            });

            irc.addListener("join#sixgaminggg", function(nick, message) {
                SixGaming.join(nick, message);
            });

            irc.addListener("part#sixgaminggg", function(nick, reason, message) {
                SixGaming.part(nick, reason, message);
            });

            irc.addListener("+mode", function(channel, by, mode, argument, message) {
                if (channel === "#sixgaminggg") {
                    SixGaming["+mode"](by, mode, argument, message);
                }
            });

            discord.addListener("ready", function() {
                sixDiscord = discord.servers.get("name", "Six Gaming");
                sixBotGGChannel = discord.channels.get("name", "sixbotgg");
                liveStreamAnnouncementsChannel = discord.channels.get("name", "live-stream-announcements");
                streamersRole = sixDiscord.roles.get("name", "Streamers");

                if (!readied) {
                    readied = true;

                    ircConnect();
                    checkSixIsLive();
                    SixGaming.commandRotation();
                    sixDiscord.channels.filter(function(channel) {
                        return channel.type === "voice";
                    }).forEach(function(channel) {
                        if (channel.name !== "\u{1F4AC} General" && channel.members.length === 0) {
                            SixGaming.markEmptyVoiceChannel(channel);
                        }
                    });
                }
            });

            discord.addListener("message", function(message) {
                if (message.server && message.server.name === "Six Gaming" && message.channel.name === "sixbotgg" && message.channel.type === "text") {
                    SixGaming.discordMessage(message.author.username, message.author, message.cleanContent);
                }
            });

            discord.addListener("voiceJoin", function(channel, user) {
                userChannels[user.id] = channel.id;
                channelCounts[channel.id] = channelCounts[channel.id] ? channelCounts[channel.id] + 1 : 1;
                if (channelDeletionTimeouts[channel.id]) {
                    clearTimeout(channelDeletionTimeouts[channel.id]);
                    delete channelDeletionTimeouts[channel.id];
                }
            });

            discord.addListener("voiceLeave", function(channel, user) {
                if (!userChannels[user.id]) {
                    return;
                }
                channel = sixDiscord.channels.get("id", userChannels[user.id]);
                delete userChannels[user.id];
                channelCounts[channel.id]--;
                if (channel.name !== "\u{1F4AC} General" && channelCounts[channel.id] === 0) {
                    SixGaming.markEmptyVoiceChannel(channel);
                }
            });

            discordConnect();
        });
    };

    startup();
};

SixGaming.commandRotation = function() {
    if (commandRotationWait <= 0) {
        SixGaming.ircMessages[autoCommandRotation[0]]("SixBotGG");
    }

    commandRotationTimeout = setTimeout(function() {
        SixGaming.commandRotation();
    }, 600000);
};

SixGaming.ircQueue = function(message) {
    irc.say("#sixgaminggg", message);
};

SixGaming.discordQueue = function(message, channel) {
    if (!channel) {
        channel = sixBotGGChannel;
    }
    discord.sendMessage(channel, message);
};

SixGaming.sortDiscordChannels = function() {
    var channels = sixDiscord.channels.filter(function(channel) {
        return channel.name.startsWith("twitch-") || channel.name.startsWith("game-");
    }).sort(function(a, b) {
        if (a.name.startsWith("twitch-") && b.name.startsWith("game-")) {
            return -1;
        }

        if (a.name.startsWith("game-") && b.name.startsWith("twitch-")) {
            return 1;
        }

        return a.name.localeCompare(b.name);
    }),
        index = 0,

        positionChannel = function() {
            var channel = sixDiscord.channels.get("id", channels[index].id);
            if (channel.bitrate !== undefined) {
                delete channel.bitrate;
            }
            discord.updateChannel(
                channel, {position: 100 + index}, function(err) {
                    index++;
                    if (index < channels.length) {
                        positionChannel();
                    }
                }
            )
        };

    positionChannel();
};

SixGaming.markEmptyVoiceChannel = function(channel) {
    channelDeletionTimeouts[channel.id] = setTimeout(function() {
        discord.deleteChannel(channel);
        delete channelDeletionTimeouts[channel.id];
    }, 300000)
};

SixGaming.names = function(_nicks) {
    nicks = _nicks;
};

SixGaming.join = function(nick, message) {
    nicks[nick] = "";
};

SixGaming.part = function(nick, reason, message) {
    delete(nicks[nick]);
};

SixGaming["+mode"] = function(by, mode, argument, message) {
    if (mode === "o" && nicks[message.args[2]] !== "o") {
        nicks[message.args[2]] = "o";
        if (message.args[2] !== "sixbotgg" && message.args[2] !== "sixgaminggg") {
            SixGaming.ircQueue("Hi, " + message.args[2] + "! HeyGuys");
        }
    }
};

SixGaming.isAdmin = function(name) {
    return nicks[name] === "o";
};

SixGaming.isPodcaster = function(user) {
    return sixDiscord.rolesOfUser(user).filter(function(role) {
        return role.name === "Podcasters";
    }).length > 0;
};

SixGaming.ircMessage = function(from, text) {
    var matches = messageParse.exec(text);

    commandRotationWait--;

    if (matches) {
        if (SixGaming.ircMessages[matches[1]]) {
            SixGaming.ircMessages[matches[1]].call(this, from, matches[2]);
        }
    }
};

SixGaming.ircMessages = {
    facebook: function(from, message) {
        if (!message) {
            var index = autoCommandRotation.indexOf("facebook");
            if (index !== -1) {
                commandRotationWait = 5;
                autoCommandRotation.splice(index, 1);
                autoCommandRotation.push("facebook");
            }
            SixGaming.ircQueue("Check out Six Gaming on Facebook at http://fb.me/SixGamingGG");
            clearTimeout(commandRotationTimeout);
            commandRotationTimeout = setTimeout(function() {
                SixGaming.commandRotation();
            }, 600000);
        }
    },

    twitter: function(from, message) {
        if (!message) {
            var index = autoCommandRotation.indexOf("twitter");
            if (index !== -1) {
                commandRotationWait = 5;
                autoCommandRotation.splice(index, 1);
                autoCommandRotation.push("twitter");
            }
            SixGaming.ircQueue("Follow Six Gaming on Twitter at http://twitter.com/SixGamingGG");
            clearTimeout(commandRotationTimeout);
            commandRotationTimeout = setTimeout(function() {
                SixGaming.commandRotation();
            }, 600000);
        }
    },

    youtube: function(from, message) {
        if (!message) {
            var index = autoCommandRotation.indexOf("youtube");
            if (index !== -1) {
                commandRotationWait = 5;
                autoCommandRotation.splice(index, 1);
                autoCommandRotation.push("youtube");
            }
            SixGaming.ircQueue("Visit Six Gaming's YouTube page for a complete archive of our podcast at http://ronc.li/six-youtube");
            clearTimeout(commandRotationTimeout);
            commandRotationTimeout = setTimeout(function() {
                SixGaming.commandRotation();
            }, 600000);
        }
    },

    itunes: function(from, message) {
        if (!message) {
            var index = autoCommandRotation.indexOf("itunes");
            if (index !== -1) {
                commandRotationWait = 5;
                autoCommandRotation.splice(index, 1);
                autoCommandRotation.push("itunes");
            }
            SixGaming.ircQueue("Subscribe to Six Gaming's video podcast on iTunes at http://ronc.li/six-itunes");
            clearTimeout(commandRotationTimeout);
            commandRotationTimeout = setTimeout(function() {
                SixGaming.commandRotation();
            }, 600000);
        }
    },

    discord: function(from, message) {
        if (!message) {
            var index = autoCommandRotation.indexOf("discord");
            if (index !== -1) {
                commandRotationWait = 5;
                autoCommandRotation.splice(index, 1);
                autoCommandRotation.push("discord");
            }
            SixGaming.ircQueue("Join the Six Gaming Discord server for all the memes!  We are a community of gamers that enjoy playing together.  Join at http://ronc.li/six-discord!");
            clearTimeout(commandRotationTimeout);
            commandRotationTimeout = setTimeout(function() {
                SixGaming.commandRotation();
            }, 600000);
        }
    },

    version: function(from, message) {
        if (!message) {
            SixGaming.ircQueue("SixBotGG by roncli, Version " + pjson.version);
        }
    },

    host: function(from, message) {
        if (message && SixGaming.isAdmin(from)) {
            if (sixIsLive) {
                SixGaming.ircQueue("Sorry, " + from + ", but Six Gaming is live right now!");
            } else {
                twitch.getChannelStream(message, function(err, results) {
                    manualHosting = !err && results && results.stream;
                    if (manualHosting) {
                        currentHost = message;
                        SixGaming.ircQueue("Now hosting " + currentHost + ".  Check out their stream at http://twitch.tv/" + currentHost + "!");
                        SixGaming.ircQueue("/host " + currentHost);
                        nextCheckHost = 0;
                        secondaryChangeHost = 0;
                    } else {
                        SixGaming.ircQueue("Sorry, " + from + ", but " + message + " is not live right now.");
                    }
                });
            }
        }
    },

    unhost: function(from, message) {
        if (!message && SixGaming.isAdmin(from)) {
            SixGaming.ircQueue("/unhost");
            manualHosting = false;
            currentHost = "";
            nextCheckHost = 0;
            secondaryChangeHost = 0;
        }
    },

    confirm: function(from, message) {
        if (message && codeParse.test(message)) {
            var code = +message;

            db.query(
                "select discord from streamer where streamer = @streamer and code = @code",
                {
                    streamer: {type: db.VARCHAR(50), value: from},
                    code: {type: db.INT, value: code}
                },
                function(err, data) {
                    var user, matches, username, discriminator;

                    if (err) {
                        SixGaming.ircQueue("Sorry, " + from + ", but the server is currently down.  Try later, or get a hold of roncli for fixing.");
                        return;
                    }

                    if (data[0].length === 0) {
                        return;
                    }

                    user = data[0][0].discord;
                    matches = userParse.exec(user);
                    username = matches[1];
                    discriminator = matches[2];

                    db.query(
                        "update streamer set code = 0, validated = 1 where streamer = @streamer;delete from host where streamer = @streamer",
                        {streamer: {type: db.VARCHAR(50), value: from}},
                        function(err, data) {
                            var serverChannels = ["six-gaming-info", "live-stream-announcements", "general", "podcast", "podcasters", "sixbotgg"],
                                users, user, hostIndex;

                            if (err) {
                                SixGaming.ircQueue("Sorry, " + from + ", but the server is currently down.  Try later, or get a hold of roncli for fixing.");
                                return;
                            }

                            users = discord.users.getAll("username", username);
                            if (users) {
                                user = users.get("discriminator", discriminator);
                            }
                            if (users) {
                                discord.addMemberToRole(user, streamersRole);
                            }

                            discord.createChannel(sixDiscord, "twitch-" + from, function(err, channel) {
                                if (channel.bitrate !== undefined) {
                                    delete channel.bitrate;
                                }
                                discord.updateChannel(
                                    channel,
                                    {
                                        topic: "This channel is for @" + username + "'s Twitch stream.  Follow @" + username + " on Twitch at http://twitch.tv/" + from + ".",
                                        position: 9999
                                    },
                                    SixGaming.sortDiscordChannels
                                );

                                SixGaming.ircQueue("You're all set, " + from + ". You are now a Six Gaming streamer!");
                                SixGaming.discordQueue(user + " is now setup as a Six Gaming streamer at http://twitch.tv/" + from + " and their Discord channel has been created at " + channel + ".");
                                streamers.push(from);
                                hostIndex = hosts.indexOf(from);
                                if (hostIndex !== -1) {
                                    hosts.splice(hostIndex, 1);
                                }
                            });
                        }
                    );
                }
            );
        }
    }
};

SixGaming.discordMessage = function(from, user, text) {
    var matches = messageParse.exec(text);

    if (matches) {
        if (SixGaming.discordMessages[matches[1]]) {
            SixGaming.discordMessages[matches[1]].call(this, from, user, matches[2]);
        }
    }
};

SixGaming.discordMessages = {
    version: function(from, user, message) {
        if (!message) {
            SixGaming.discordQueue("SixBotGG by roncli, Version " + pjson.version);
        }
    },

    host: function(from, user, message) {
        if (message && SixGaming.isPodcaster(user)) {
            if (sixIsLive) {
                SixGaming.discordQueue("Sorry, " + user + ", but Six Gaming is live right now!");
            } else {
                twitch.getChannelStream(message, function(err, results) {
                    manualHosting = !err && results && results.stream;
                    if (manualHosting) {
                        currentHost = message;
                        SixGaming.ircQueue("Now hosting " + currentHost + ".  Check out their stream at http://twitch.tv/" + currentHost + "!");
                        SixGaming.ircQueue("/host " + currentHost);
                        SixGaming.discordQueue("Now hosting " + currentHost + ".  Check out their stream at http://twitch.tv/" + currentHost + "!");
                        nextCheckHost = 0;
                        secondaryChangeHost = 0;
                    } else {
                        SixGaming.discordQueue("Sorry, " + user + ", but " + message + " is not live right now.");
                    }
                });
            }
        }
    },

    unhost: function(from, user, message) {
        if (!message && SixGaming.isPodcaster(user)) {
            SixGaming.ircQueue("/unhost");
            SixGaming.discordQueue("Exiting host mode.");
            manualHosting = false;
            currentHost = "";
            nextCheckHost = 0;
            secondaryChangeHost = 0;
        }
    },

    addtwitch: function(from, user, message) {
        if (message) {
            twitch.getChannelStream(message, function(err, results) {
                if (err || !results) {
                    SixGaming.discordQueue("Sorry, " + user + ", but " + message + " is not a valid Twitch streamer.");
                    return;
                }

                db.query(
                    "select discord, code, validated from streamer where streamer = @streamer",
                    {streamer: {type: db.VARCHAR(50), value: from}},
                    function(err, data) {
                        var username = user.username + "#" + user.discriminator,
                            code;

                        if (err) {
                            SixGaming.discordQueue("Sorry, " + user + ", but the server is currently down.  Try later, or get a hold of roncli for fixing.");
                            return;
                        }

                        if (data && data[0] && data[0][0]) {
                            if (data[0][0].discord !== username) {
                                SixGaming.discordQueue("Sorry, " + user + ", but " + message + " has already been registered by @" + discord + ".  If this is in error, get a hold of roncli for fixing.");
                                return;
                            }

                            if (data[0][0].validated) {
                                SixGaming.discordQueue("Sorry, " + user + ", but you're already validated!");
                                return;
                            }

                            SixGaming.discordQueue(user + ", please log in to Twitch as " + message + ", visit http://twitch.tv/SixGamingGG, and enter the command `!confirm " + data[0][0].code + "` into chat.");
                            return;
                        }

                        code = Math.floor(Math.random() * 900 + 100);
                        db.query(
                            "insert into streamer (streamer, discord, code) values (@streamer, @discord, @code)",
                            {
                                streamer: {type: db.VARCHAR(50), value: message},
                                discord: {type: db.VARCHAR(50), value: username},
                                code: {type: db.INT, value: code}
                            },
                            function(err) {
                                if (err) {
                                    SixGaming.discordQueue("Sorry, " + user + ", but the server is currently down.  Try later, or get a hold of roncli for fixing.");
                                    return;
                                }

                                SixGaming.discordQueue(user + ", please log in to Twitch as " + message + ", visit http://twitch.tv/SixGamingGG, and enter the command `!confirm " + code + "` into chat.");
                            }
                        )
                    }
                )
            });
        }
    },

    removetwitch: function(from, user, message) {
        if (!message) {
            db.query(
                "select id, streamer from streamer where discord = @discord",
                {discord: {type: db.VARCHAR(50), value: user.username + "#" + user.discriminator}},
                function(err, data) {
                    var id, streamer;

                    if (err) {
                        SixGaming.discordQueue("Sorry, " + user + ", but the server is currently down.  Try later, or get a hold of roncli for fixing.");
                        return;
                    }

                    if (!data || !data[0] || !data[0][0]) {
                        SixGaming.discordQueue(user + ", you are not currently registered as a streamer.");
                        return;
                    }

                    id = data[0][0].id;
                    streamer = data[0][0].streamer;

                    db.query(
                        "delete from streamer where id = @id",
                        {id: {type: db.INT, value: id}},
                        function(err) {
                            var streamerIndex;

                            if (err) {
                                SixGaming.discordQueue("Sorry, " + user + ", but the server is currently down.  Try later, or get a hold of roncli for fixing.");
                                return;
                            }

                            discord.removeMemberFromRole(user, streamersRole);
                            discord.deleteChannel(sixDiscord.channels.get("name", "twitch-" + streamer));

                            streamerIndex = streamers.indexOf(streamer);
                            if (streamerIndex !== -1) {
                                streamers.splice(streamerIndex, 1);
                            }
                            SixGaming.discordQueue(user + ", you have been removed as a streamer.");
                        }
                    )
                }
            );
        }
    },

    addstreamer: function(from, user, message) {
        if (message && SixGaming.isPodcaster(user)) {
            twitch.getChannelStream(message, function(err, results) {
                if (err || !results) {
                    SixGaming.discordQueue("Sorry, " + user + ", but " + message + " is not a valid Twitch streamer.");
                    return;
                }

                db.query(
                    "select streamer from host where streamer = @streamer",
                    {streamer: {type: db.VARCHAR(50), value: message}},
                    function(err, data) {
                        if (err) {
                            SixGaming.discordQueue("Sorry, " + user + ", but the server is currently down.  Try later, or get a hold of roncli for fixing.");
                            return;
                        }

                        if (data && data[0] && data[0][0]) {
                            SixGaming.discordQueue("Sorry, " + user + ", but " + message + " is already added as a streamer to be hosted.");
                            return;
                        }

                        db.query(
                            "insert into host (streamer) values (@streamer)",
                            {
                                streamer: {type: db.VARCHAR(50), value: message}
                            },
                            function(err) {
                                if (err) {
                                    SixGaming.discordQueue("Sorry, " + user + ", but the server is currently down.  Try later, or get a hold of roncli for fixing.");
                                    return;
                                }

                                hosts.push(message);
                                SixGaming.discordQueue(user + ", you have successfully added " + message + " as a streamer to be hosted.");
                            }
                        )
                    }
                )
            });
        }
    },

    removestreamer: function(from, user, message) {
        if (message && SixGaming.isPodcaster(user)) {
            db.query(
                "select id from host where streamer = @streamer",
                {streamer: {type: db.VARCHAR(50), value: message}},
                function(err, data) {
                    var id;

                    if (err) {
                        SixGaming.discordQueue("Sorry, " + user + ", but the server is currently down.  Try later, or get a hold of roncli for fixing.");
                        return;
                    }

                    if (!data || !data[0] || !data[0][0]) {
                        SixGaming.discordQueue(user + ", " + message + " is not currently a hosted streamer.");
                        return;
                    }

                    id = data[0][0].id;

                    db.query(
                        "delete from host where id = @id",
                        {id: {type: db.INT, value: id}},
                        function(err) {
                            var hostIndex;

                            if (err) {
                                SixGaming.discordQueue("Sorry, " + user + ", but the server is currently down.  Try later, or get a hold of roncli for fixing.");
                                return;
                            }

                            hostIndex = hosts.indexOf(message);
                            if (hostIndex !== -1) {
                                hosts.splice(hostIndex, 1);
                            }

                            SixGaming.discordQueue(user + ", " + message + " has been removed as a hosted streamer.");
                        }
                    )
                }
            );
        }
    },

    addchannel: function(from, user, message) {
        if (message) {
            if (userCreatedChannels[user.id]) {
                SixGaming.discordQueue("Sorry, " + user + ", but you can only create a voice channel once every five minutes.");
                return;
            }

            if (user.voiceChannel) {
                SixGaming.discordQueue("Sorry, " + user + ", but you are already chatting in " + user.voiceChannel.name + ".");
                return;
            }

            if (sixDiscord.channels.getAll("name", "message").length > 0) {
                SixGaming.discordQueue("Sorry, " + user + ", but " + message + " already exists as a voice channel.");
                return;
            }

            discord.createChannel(sixDiscord, message, "voice", function(err, channel) {
                if (err) {
                    console.log(err);
                    SixGaming.discordQueue("Sorry, " + user + ", but there was a problem with adding this Discord channel.");
                    return;
                }

                if (!channelCounts[channel.id] || channelCounts[channel.id] === 0) {
                    SixGaming.markEmptyVoiceChannel(channel);
                }
                userCreatedChannels[user.id] = setTimeout(function() {
                    delete userCreatedChannels[user.id];
                }, 300000);
                SixGaming.discordQueue(user + ", the voice channel " + message + " has been created.  It will be automatically deleted after being empty for 5 minutes.");
            });
        }
    },

    addgame: function(from, user, message) {
        var matches = addGameParse.exec(message),
            short, game;

        if (message && SixGaming.isPodcaster(user) && matches) {
            short = matches[1].toLowerCase();
            game = matches[2];

            if (sixDiscord.roles.getAll("name", short).length > 0) {
                SixGaming.discordQueue("Sorry, " + user + ", but the role for game " + short + " has already been created.");
                return;
            }

            discord.createRole(sixDiscord, {
                name: short,
                color: 0xFF0000,
                hoist: false,
                mentionable: true
            }, function(err, role) {
                if (err) {
                    console.log(err);
                    SixGaming.discordQueue("Sorry, " + user + ", but there was a problem with adding this role to Discord.");
                    return;
                }

                discord.addMemberToRole(user, role);

                db.query(
                    "insert into game (game, code) values (@game, @code)",
                    {
                        game: {type: db.VARCHAR(255), value: game},
                        code: {type: db.VARCHAR(50), value: short}
                    },
                    function() {}
                );

                discord.createChannel(sixDiscord, "game-" + short, function(err, channel) {
                    if (channel.bitrate !== undefined) {
                        delete channel.bitrate;
                    }
                    discord.updateChannel(
                        channel,
                        {
                            topic: "This channel is for discussion of " + game + ".  Enter `!notify " + short + "` in #sixbotgg to be notified when others wish to play.  Mention @" + short + " to alert others when you wish to play!",
                            position: 9999
                        },
                        SixGaming.sortDiscordChannels
                    );

                    SixGaming.discordQueue(user + ", " + role + " has been setup as a mentionable role with you as the first member!  You may also discuss the game " + game + " in " + channel + ".  Anyone may join this role to be notified by entering `!notify " + short + "`.");
                });
            });
        }
    },

    removegame: function(from, user, message) {
        if (message && user.name === settings.admin.username && user.discriminator == settings.admin.discriminator) {
            message = message.toLowerCase();

            if (sixDiscord.roles.getAll("name", message).length === 0) {
                SixGaming.discordQueue("Sorry, " + user + ", but the game " + message + " does not exist.");
                return;
            }

            if (sixDiscord.channels.getAll("name", "game-" + message).length === 0) {
                SixGaming.discordQueue("Sorry, " + user + ", but the role " + message + " is not a role that can be removed using this command.");
                return;
            }

            discord.deleteRole(sixDiscord.roles.get("name", message));
            discord.deleteChannel(sixDiscord.channels.get("name", "game-" + message));

            db.query(
                "delete from game where code = @code", {code: {type: db.VARCHAR(50), value: message}}, function() {}
            );

            SixGaming.discordQueue(user + ", the game " + message + " has been removed.");
        }
    },

    notify: function(from, user, message) {
        if (message) {
            var role;

            message = message.toLowerCase();

            if (sixDiscord.roles.getAll("name", message).length === 0) {
                SixGaming.discordQueue("Sorry, " + user + ", but the game " + message + " does not exist.");
                return;
            }

            if (sixDiscord.channels.getAll("name", "game-" + message).length === 0) {
                SixGaming.discordQueue("Sorry, " + user + ", but the role " + message + " is not a role that you can be notified for using this command.");
                return;
            }

            role = sixDiscord.roles.get("name", message);

            discord.addMemberToRole(user, role, function(err) {
                if (err) {
                    console.log(err);
                    SixGaming.discordQueue("Sorry, " + user + ", but there was a problem with setting you up to be notified in Discord.  Are you sure you're not already setup to be notified for this game?");
                    return;
                }

                SixGaming.discordQueue(user + ", you have been setup to be notified whenever " + role.name + " is mentioned!");
            });
        }
    },

    unnotify: function(from, user, message) {
        if (message) {
            var role;

            message = message.toLowerCase();

            if (sixDiscord.roles.getAll("name", message).length === 0) {
                SixGaming.discordQueue("Sorry, " + user + ", but the game " + message + " does not exist.");
                return;
            }

            if (sixDiscord.channels.getAll("name", "game-" + message).length === 0) {
                SixGaming.discordQueue("Sorry, " + user + ", but the role " + message + " is not a role that you can be notified for using this command.");
                return;
            }

            role = sixDiscord.roles.get("name", message);

            discord.removeMemberFromRole(user, role, function(err) {
                if (err) {
                    console.log(err);
                    SixGaming.discordQueue("Sorry, " + user + ", but there was a problem with setting you up to not be notified in Discord.  Are you sure you were setup to be notified for this game?");
                    return;
                }

                SixGaming.discordQueue(user + ", you have been setup to no longer be notified whenever " + role.name + " is mentioned!");
            });
        }
    },

    games: function(from, user, message) {
        if (!message) {
            db.query(
                "select game, code from game order by code", {}, function(err, data) {
                    var response = "You may use `!notify <game>` for the following games:";

                    if (err || !data || !data[0]) {
                        SixGaming.ircQueue("Sorry, " + from + ", but the server is currently down.  Try later, or get a hold of roncli for fixing.");
                        return;
                    }

                    data[0].forEach(function(row) {
                        response += "\n`" + row.code + "` - " + row.game;
                    });

                    SixGaming.discordQueue(response, user);
                }
            )
        }
    },

    help: function(from, user, message) {
        if (!message) {
            SixGaming.discordQueue(user + ", see the documentation in " + sixDiscord.channels.get("name", "six-gaming-info") + ".");
        }
    }
};

module.exports = SixGaming;
