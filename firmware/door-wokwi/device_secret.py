# Gives the simulated door a key that survives between runs. A simulator may
# start with empty flash each time, which would mean pairing on every run.
# Made once, kept in .device-secret (git-ignored). To simulate a second room,
# copy this folder and delete .device-secret from the copy.
import os
import secrets

Import("env")

path = os.path.join(env["PROJECT_DIR"], ".device-secret")
if not os.path.exists(path):
    with open(path, "w") as f:
        f.write(secrets.token_hex(24))
with open(path) as f:
    secret = f.read().strip()

env.Append(CPPDEFINES=[("BUILD_SECRET", env.StringifyMacro(secret))])
