# The installed TV app

`config.xml` is the TV app's manifest; tv.yml packages it with the TV build.

`native-api.txt` is what the installed app (this config, `tv/boot.js`) offers
the app's code. Over-the-air bundles say which level they need, and an older
installed app ignores bundles it can't run. Bump it when a change needs a
reinstall: a new privilege or metadata in `config.xml`, or a change to how
`tv/boot.js` starts the app.
