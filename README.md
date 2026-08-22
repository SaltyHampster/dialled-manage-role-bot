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
