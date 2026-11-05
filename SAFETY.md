# Safety rules

These challenges start containers on your machine. Your machine also runs your other work, and Docker is shared. These rules keep the challenges small and keep your other work safe. They are repeated, short, in every README.

## The rules

1. **Everything we create has a name and a label.** Names look like `dkr-c3-web`. Every container, network and volume also carries the label `dkr.challenge=3` (the number is the challenge). The toolkit adds both for you.
2. **Cleanup uses the label and nothing else.** `node toolkit/cleanup.mjs 3` removes only objects with the label `dkr.challenge=3`. It does not touch your other containers, images, networks or volumes.
3. **Never run `docker system prune`, `docker volume prune` or `docker image prune -a` here.** They delete things you did not create here. Other projects on your machine may need those images and volumes.
4. **Every experiment has limits.** Memory (`--memory`), processes (`--pids-limit`) and disk (a `--tmpfs` with a size, and log `max-size`). If an experiment goes wrong, it stops at the limit and does not use the whole machine.
5. **No `--privileged` and no Docker socket mount.** There are named exceptions, and each README tells you why. Challenge 1 runs one capped helper container (256 MB, 200 processes) with two extra capabilities (`SYS_ADMIN` and `NET_ADMIN`) and a seccomp profile that also allows `pivot_root`, so you can build a container by hand. It is not `--privileged` and has no Docker socket. Challenges 13 and 14 run one Docker-in-Docker host in a throwaway container. On native Linux with AppArmor, the default profile may block `mount` in challenge 1. That case is untested. If it happens, you may add `--security-opt apparmor=unconfined` to that one helper container only, and write the change here.
6. **Nothing touches a real account or system.** No real passwords, no real cloud accounts, no production hosts. Where a part needs GitHub, it is your own repository, and the README says what to expect.
7. **Check your free disk first.** Run `node toolkit/check-setup.mjs`. It stops you if less than 2 GB is free. Images are the biggest cost. Each README tells you the download size before you pull.
8. **Remove only what you made.** If you need to remove something by hand, use the full name, for example `docker rm -f dkr-c3-web`. Do not use wildcards, and do not remove by "everything".

## If something goes wrong

- Run `node toolkit/cleanup.mjs <challenge number>`.
- Run `docker ps -a --filter label=dkr.challenge` to see what is left from any challenge.
- If Docker itself is stuck, restart Docker Desktop or the docker service. Your images and volumes stay.

## What is different on Docker Desktop

Docker Desktop runs Docker inside a small Linux virtual machine. The memory and disk Docker can use are the limits of that machine, not of your computer. On the Hyper-V or macOS setup, the limits are in Docker Desktop under Settings, then Resources. On the WSL 2 setup, they come from `.wslconfig` in your user folder; change them there and run `wsl --shutdown`. The READMEs have a box where behaviour differs.
