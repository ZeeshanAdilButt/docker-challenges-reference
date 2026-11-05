# The container you will harden. It is deliberately a little careless:
#  - it has doas installed (a setuid program, like sudo) and the user "app" may use it without a password,
#  - it has a root-only file that must stay secret,
#  - nothing in the image limits the user, so the flags you choose at run time decide everything.
FROM alpine:3.23
LABEL dkr.challenge="12"
RUN apk add --no-cache busybox-extras doas \
 && mkdir -p /etc/doas.d && echo 'permit nopass app' > /etc/doas.d/app.conf && echo 'permit nopass root' >> /etc/doas.d/app.conf \
 && addgroup -g 10001 app && adduser -D -u 10001 -G app app \
 && mkdir -p /www \
 && echo '{"status":"ok"}' > /www/health \
 && echo 'hello from the target' > /www/index.html \
 && echo 'root-only-secret-dkrcanary' > /root/secret.txt && chmod 600 /root/secret.txt
EXPOSE 8080
CMD ["busybox-extras", "httpd", "-f", "-p", "8080", "-h", "/www"]
