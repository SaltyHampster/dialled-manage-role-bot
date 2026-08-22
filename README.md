# dialled community bot

handles invite-based auto roles (free / paid) and 1:1 channel creation for paid students.
runs as its own railway service, deployed from its own github repo, using the same
discord bot token as the existing job board bot.

## setup

1. push this folder to a new github repo
2. new railway project, deploy from that repo
3. set the env vars below in railway
4. in the discord developer portal, on the bot's application, turn on **server members intent**
5. in the discord server, drag the bot's role above `free`, `free-verified`, and `paid-student`
   in server settings → roles, or role assignment will silently fail

## env vars

see .env.example

## discord oauth setup (do this after first deploy)

1. deploy once with the oauth vars blank, so railway gives you a public url
2. copy that url, set `DISCORD_REDIRECT_URI` to `<that url>/auth/discord/callback`
3. in the dev portal, oauth2 tab: add that exact same url under redirects, save
4. copy client id and client secret from the same tab into `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`
5. redeploy

## how the form connects

end your lead form with a link/button to:
`https://<your-railway-url>/auth/discord?state=<their email or any id from the form>`

they get sent to discord, approve, land back on your bot, and get the
free-verified role automatically. `state` is just carried through and logged,
useful for matching the discord grant back to the form submission in your logs,
not required for the role grant itself to work.

`/api/verify-lead` is kept as a manual fallback if oauth ever fails for someone.
