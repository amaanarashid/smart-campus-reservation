# Puts the built firmware where the web app serves it:
#   public/firmware/esp32-devkit/   (pio run -e board)   browser install, Admin -> Smart room
#   public/firmware/esp32-cam/      (pio run -e cam)     browser install
#   public/firmware/wokwi/          (pio run -e wokwi-web) the "Simulated door" download;
#                                   the app writes the room's key into it
#
# Runs by itself after those builds (see platformio.ini), or by hand:
#     python publish_web.py board .pio/build/board
# Commit public/firmware and deploy.
#
# The local simulator build ("esp32") is never published: it has the laptop's
# door key compiled in.
import json
import os
import shutil
import struct
import subprocess
import sys
from datetime import datetime, timezone

TARGETS = {"board": "esp32-devkit", "cam": "esp32-cam", "wokwi-web": "wokwi"}
NAMES = {"esp32-devkit": "Smart room device (ESP32 DevKit)", "esp32-cam": "Smart room device (ESP32-CAM)",
         "wokwi": "Smart room door (Wokwi simulation)"}
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()


def app_offsets(partitions_bin):
    """(otadata, first app) offsets read from the partition table itself."""
    data = open(partitions_bin, "rb").read()
    otadata = app = None
    for i in range(0, len(data), 32):
        entry = data[i:i + 32]
        if entry[:2] != b"\xaa\x50":
            break
        ptype, subtype, offset = struct.unpack("<BBI", entry[2:8])
        if ptype == 1 and subtype == 0 and otadata is None:
            otadata = offset
        if ptype == 0 and app is None:
            app = offset
    return otadata, app


def publish(env_name, build_dir, project_dir=HERE, boot_app0=None, out_root=None):
    folder = TARGETS.get(env_name)
    if not folder:
        print("publish_web: %s is not published" % env_name)
        return
    out_root = out_root or os.path.normpath(os.path.join(project_dir, "..", "..", "public", "firmware"))
    out = os.path.join(out_root, folder)
    src = {name: os.path.join(build_dir, name) for name in ("bootloader.bin", "partitions.bin", "firmware.bin")}
    missing = [p for p in src.values() if not os.path.exists(p)]
    if missing:
        print("publish_web: not published, missing " + ", ".join(missing))
        return
    otadata, app = app_offsets(src["partitions.bin"])
    if app is None:
        print("publish_web: not published, no app partition in partitions.bin")
        return

    os.makedirs(out, exist_ok=True)
    for name, path in src.items():
        shutil.copyfile(path, os.path.join(out, name))
    parts = [{"path": "bootloader.bin", "offset": 0x1000}, {"path": "partitions.bin", "offset": 0x8000}]
    if otadata is not None:
        target = os.path.join(out, "boot_app0.bin")
        if boot_app0 and os.path.exists(boot_app0):
            shutil.copyfile(boot_app0, target)
        else:                                   # erased OTA data: the bootloader starts the first app
            with open(target, "wb") as f:
                f.write(b"\xff" * 0x2000)
        parts.append({"path": "boot_app0.bin", "offset": otadata})
    parts.append({"path": "firmware.bin", "offset": app})
    if folder == "wokwi":
        shutil.copyfile(os.path.join(project_dir, "diagram.json"), os.path.join(out, "diagram.json"))

    try:
        commit = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=project_dir,
                                         stderr=subprocess.DEVNULL, text=True).strip()
    except Exception:
        commit = "local"
    built = datetime.fromtimestamp(os.path.getmtime(src["firmware.bin"]), timezone.utc)
    manifest = {
        "name": NAMES[folder],
        "version": built.strftime("%Y-%m-%d %H:%M UTC") + " (" + commit + ")",
        "new_install_prompt_erase": True,
        "new_install_improv_wait_time": 0,  # Wi-Fi is set up through the device's own setup network
        "builds": [{"chipFamily": "ESP32", "parts": parts}],
    }
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    print("publish_web: %s firmware is in %s" % (folder, out))


try:
    Import("env")  # noqa: F821 - defined when PlatformIO runs this
except NameError:
    env = None

if env is not None:
    def _after_build(source, target, env):
        boot = os.path.join(env.PioPlatform().get_package_dir("framework-arduinoespressif32") or "",
                            "tools", "partitions", "boot_app0.bin")
        publish(env["PIOENV"], env.subst("$BUILD_DIR"), env["PROJECT_DIR"], boot)

    if env["PIOENV"] in TARGETS:
        env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", _after_build)
elif __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: python publish_web.py <board|cam|wokwi-web> <build folder>")
    publish(sys.argv[1], sys.argv[2])
