// probe.mjs: print what a process can see about its own container, as one line of JSON.
// It runs inside the container, so it reads the real /proc and /sys files. Node 22 or newer.
import fs from 'node:fs';
import os from 'node:os';

const read = (p) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};
const link = (p) => {
  try {
    return fs.readlinkSync(p);
  } catch {
    return null;
  }
};
const status = read('/proc/self/status') ?? '';
const field = (k) => status.match(new RegExp(`^${k}:\s*(.*)$`, 'm'))?.[1] ?? null;
const canRead = (p) => {
  try {
    const fd = fs.openSync(p, 'r');
    const n = fs.readSync(fd, Buffer.alloc(16), 0, 16, 0);
    fs.closeSync(fd);
    return n > 0;
  } catch {
    return false;
  }
};
const canWrite = (p) => {
  try {
    fs.accessSync(p, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const ns = {};
for (const n of fs.readdirSync('/proc/self/ns').sort()) ns[n] = link(`/proc/self/ns/${n}`);

const mountinfo = (read('/proc/self/mountinfo') ?? '').trim().split('\n');
const num = (s) => (s === null || s.trim() === 'max' ? s?.trim() ?? null : Number(s.trim()));

console.log(
  JSON.stringify({
    hostname: os.hostname(),
    pid: process.pid,
    uid: process.getuid(),
    pid1: (read('/proc/1/cmdline') ?? '').split('\0').filter(Boolean).join(' '),
    visible_pids: fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)).length,
    ns,
    cap_eff: field('CapEff'),
    cap_bnd: field('CapBnd'),
    no_new_privs: field('NoNewPrivs'),
    seccomp: Number(field('Seccomp')),
    mounts: mountinfo.length,
    root_fstype: mountinfo[0]?.split(' - ')[1]?.split(' ')[0] ?? null,
    cgroup_path: (read('/proc/self/cgroup') ?? '').trim(),
    memory_max: num(read('/sys/fs/cgroup/memory.max')),
    pids_max: num(read('/sys/fs/cgroup/pids.max')),
    interfaces: Object.keys(os.networkInterfaces()).sort(),
    eth0_ipv4: os.networkInterfaces().eth0?.find((a) => a.family === 'IPv4')?.address ?? null,
    nameservers: (read('/etc/resolv.conf') ?? '').split('\n').filter((l) => l.startsWith('nameserver')).length,
    env_names: Object.keys(process.env).sort(),
    resolv_conf: fs.existsSync('/etc/resolv.conf'),
    proc_kcore_readable: canRead('/proc/kcore'),
    proc_sys_writable: canWrite('/proc/sys/kernel/hostname'),
    dev_entries: fs.readdirSync('/dev').length,
    cpus: os.availableParallelism(),
    total_mem_mb: Math.round(os.totalmem() / 1048576),
    constrained_mem_mb: Math.round((process.constrainedMemory?.() ?? 0) / 1048576),
  }),
);
