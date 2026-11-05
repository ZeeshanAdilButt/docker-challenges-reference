#!/usr/bin/env bash
# mini-container.sh: a container made by hand, the way you built one in the Linux course.
# It stands in for your own script from Linux module 14. It does four things:
#   1. a cgroup v2 directory with a memory limit and a process limit
#   2. new namespaces: pid, mount, uts (hostname), ipc and net
#   3. a root file system (a folder) that the process is locked into with pivot_root
#   4. a veth pair so the outside can reach the process
# It must run as root on a Linux host. In this challenge the "host" is a throw-away container,
# so nothing here touches your real machine.
#
#   mini-container.sh prepare
#   mini-container.sh run  NAME ROOTFS MEMORY_BYTES PIDS_MAX NETNUM  COMMAND...
#   mini-container.sh exec NAME COMMAND...
#   mini-container.sh pid  NAME
#   mini-container.sh stop NAME
set -euo pipefail

CG=/sys/fs/cgroup
STATE=/tmp/mini

# --- helpers: run busybox "ip" taken from the root file system (the host image has no ip) ---
ip_host() {   # ip_host ROOTFS ip-args...    runs in the host network namespace
  local root=$1; shift
  unshare --mount -- bash -c 'mount -t proc proc "$1/proc"; r=$1; shift; exec chroot "$r" /sbin/ip "$@"' _ "$root" "$@"
}
ip_in() {     # ip_in ROOTFS PID ip-args...   runs in the network namespace of PID
  local root=$1 pid=$2; shift 2
  unshare --mount -- bash -c 'mount -t proc proc "$1/proc"; r=$1; p=$2; shift 2; exec nsenter -t "$p" -n chroot "$r" /sbin/ip "$@"' _ "$root" "$pid" "$@"
}

cmd_prepare() {
  # Make the cgroup tree writable and give the children memory and pids control.
  mount -o remount,rw "$CG" 2>/dev/null || true
  mkdir -p "$CG/host" "$STATE"
  for p in $(cat "$CG/cgroup.procs"); do echo "$p" > "$CG/host/cgroup.procs" 2>/dev/null || true; done
  echo "+memory +pids +cpu" > "$CG/cgroup.subtree_control" 2>/dev/null || true
}

# Runs inside the new namespaces. This is PID 1 of the container until it execs your command.
cmd_init() {
  local name=$1 root=$2; shift 2
  echo 0 > "$CG/mini-$name/cgroup.procs"     # join the cgroup first: everything below is counted
  hostname "$name"
  mount --make-rprivate /
  mount --bind "$root" "$root"               # pivot_root needs a mount point
  mount -t proc proc "$root/proc"
  mount -t tmpfs -o size=4m,mode=755 tmpfs "$root/dev"
  for d in null zero full random urandom tty; do touch "$root/dev/$d"; mount --bind "/dev/$d" "$root/dev/$d"; done
  mkdir -p "$root/dev/shm"; mount -t tmpfs -o size=4m tmpfs "$root/dev/shm"
  mount -t tmpfs -o size=1m,mode=755 tmpfs "$root/sys"
  mkdir -p "$root/sys/fs/cgroup"; mount --bind -o ro "$CG/mini-$name" "$root/sys/fs/cgroup"
  mkdir -p "$root/.old"
  cd "$root"
  pivot_root . .old
  umount -l /.old; rmdir /.old
  cd /
  exec env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin PORT=8080 "$@"
}

cmd_run() {
  local name=$1 root=$2 mem=$3 pids=$4 num=$5; shift 5
  [ -e "$root/bin/busybox" ] || { echo "no busybox in $root: is the root file system filled?" >&2; exit 1; }
  mkdir "$CG/mini-$name"
  echo "$mem"  > "$CG/mini-$name/memory.max"
  echo 0       > "$CG/mini-$name/memory.swap.max"
  echo "$pids" > "$CG/mini-$name/pids.max"
  unshare --pid --mount --uts --ipc --net --fork -- "$0" _init "$name" "$root" "$@" > "$STATE/$name.log" 2>&1 < /dev/null &
  local u=$! pid=""
  for _ in $(seq 1 50); do                   # the container's PID 1, as the host sees it
    pid=$(cat "/proc/$u/task/$u/children" 2>/dev/null | awk '{print $1}') || true
    [ -n "$pid" ] && break
    sleep 0.1
  done
  [ -n "$pid" ] || { echo "container did not start"; cat "$STATE/$name.log"; exit 1; }
  echo "$pid" > "$STATE/$name.pid"
  # network: one veth pair, one end moved into the new net namespace
  ip_host "$root" link add "vh-$name" type veth      # busybox ip names the other end vethN
  local peer
  peer=$(ip_host "$root" link show | sed -n "s/^[0-9]*: \(veth[0-9]*\)@vh-$name:.*/\1/p")
  ip_host "$root" link set "$peer" netns "$pid"
  ip_host "$root" addr add "10.77.$num.1/24" dev "vh-$name"
  ip_host "$root" link set "vh-$name" up
  ip_in "$root" "$pid" link set lo up
  ip_in "$root" "$pid" link set "$peer" name eth0
  ip_in "$root" "$pid" addr add "10.77.$num.2/24" dev eth0
  ip_in "$root" "$pid" link set eth0 up
  echo "$pid"
}

cmd_exec() {
  local name=$1; shift
  local pid; pid=$(cat "$STATE/$name.pid")
  echo 0 > "$CG/mini-$name/cgroup.procs"
  exec nsenter -t "$pid" -m -u -i -n -p -- env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin PORT=8080 "$@"
}

cmd_pid() { cat "$STATE/$1.pid"; }

cmd_stop() {
  local name=$1 root=${2:-}
  local pid; pid=$(cat "$STATE/$name.pid" 2>/dev/null) || return 0
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 30); do [ -d "/proc/$pid" ] || break; sleep 0.1; done
  kill -KILL "$pid" 2>/dev/null || true
  [ -n "$root" ] && ip_host "$root" link del "vh-$name" 2>/dev/null || true
  for _ in $(seq 1 20); do rmdir "$CG/mini-$name" 2>/dev/null && break; sleep 0.1; done
  rm -f "$STATE/$name.pid"
}

c=${1:-}; shift || true
case $c in
  prepare) cmd_prepare ;;
  run)     cmd_run "$@" ;;
  _init)   cmd_init "$@" ;;
  exec)    cmd_exec "$@" ;;
  pid)     cmd_pid "$@" ;;
  stop)    cmd_stop "$@" ;;
  *) sed -n '2,21p' "$0"; exit 2 ;;
esac
