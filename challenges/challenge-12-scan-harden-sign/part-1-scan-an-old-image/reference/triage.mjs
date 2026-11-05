// triage.mjs: read a Trivy JSON report and decide what to do about it.
//
// A report looks like (trimmed):
//   { Metadata: { OS: { Family, Name, EOSL } },
//     Results: [{ Target, Class, Type, Vulnerabilities: [{ VulnerabilityID, PkgName, InstalledVersion,
//                                                         FixedVersion, Severity, Title }] }] }
// Severity is CRITICAL, HIGH, MEDIUM, LOW or UNKNOWN. FixedVersion is "" when no fix exists.
//
// Your job is in the three functions marked TODO: summarize, classify and verdict.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

/** Every vulnerability of a report as one flat list. */
export const allVulns = (report) => (report.Results ?? []).flatMap((r) => (r.Vulnerabilities ?? []).map((v) => ({ ...v, Class: r.Class })));

/**
 * Count the report.
 * Return { total, bySeverity: { CRITICAL, HIGH, MEDIUM, LOW, UNKNOWN }, fixable, unfixable, endOfLife, os }
 *   fixable    findings that have a FixedVersion
 *   unfixable  findings with an empty FixedVersion
 *   endOfLife  true when Metadata.OS.EOSL is true
 *   os         "alpine 3.11.11" (Family and Name), or "unknown"
 */
export function summarize(report) {
  const vulns = allVulns(report);
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const v of vulns) bySeverity[SEVERITIES.includes(v.Severity) ? v.Severity : 'UNKNOWN'] += 1;
  const fixable = vulns.filter((v) => v.FixedVersion).length;
  const os = report.Metadata?.OS;
  return { total: vulns.length, bySeverity, fixable, unfixable: vulns.length - fixable, endOfLife: os?.EOSL === true, os: os ? `${os.Family} ${os.Name}` : 'unknown' };
}

/**
 * Sort ONE finding into 'fix-now', 'plan' or 'accept'.
 *   fix-now  a fix exists AND (severity is CRITICAL, or severity is HIGH in a package listed in policy.runtime_packages)
 *   plan     a fix exists AND severity is HIGH or MEDIUM (and it is not fix-now)
 *   accept   everything else: no fix, or LOW, or UNKNOWN
 */
export function classify(vuln, policy) {
  if (!vuln.FixedVersion) return 'accept';
  if (vuln.Severity === 'CRITICAL') return 'fix-now';
  if (vuln.Severity === 'HIGH') return (policy.runtime_packages ?? []).includes(vuln.PkgName) ? 'fix-now' : 'plan';
  if (vuln.Severity === 'MEDIUM') return 'plan';
  return 'accept';
}

/**
 * Apply the policy to a whole report. Return { pass, counts: { 'fix-now', plan, accept }, reasons: [text] }.
 *   fail when the number of fix-now findings is more than policy.max_fix_now
 *   fail when the OS is end of life and policy.fail_on_end_of_life is true (the scanner has little data for it)
 *   reasons has one line for each failure. A passing report has reasons [].
 */
export function verdict(report, policy) {
  const counts = { 'fix-now': 0, plan: 0, accept: 0 };
  for (const v of allVulns(report)) counts[classify(v, policy)] += 1;
  const s = summarize(report);
  const reasons = [];
  if (counts['fix-now'] > policy.max_fix_now) reasons.push(`${counts['fix-now']} findings must be fixed now (allowed: ${policy.max_fix_now})`);
  if (policy.fail_on_end_of_life && s.endOfLife) reasons.push(`the base OS (${s.os}) is end of life: it gets no more fixes, and the scanner may know less about it, so a low count means little`);
  return { pass: reasons.length === 0, counts, reasons };
}

/** The packages with the most fix-now findings, as [{ pkg, installed, fixedIn, count }], biggest first. */
export function topFixes(report, policy, n = 5) {
  const map = new Map();
  for (const v of allVulns(report)) {
    if (classify(v, policy) !== 'fix-now') continue;
    const e = map.get(v.PkgName) ?? { pkg: v.PkgName, installed: v.InstalledVersion, fixedIn: v.FixedVersion, count: 0 };
    e.count += 1;
    map.set(v.PkgName, e);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.pkg.localeCompare(b.pkg)).slice(0, n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [reportFile, policyFile] = process.argv.slice(2);
  if (!reportFile || !policyFile) {
    console.error('Usage: node triage.mjs <report.json> <policy.json>');
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(reportFile, 'utf8'));
  const policy = JSON.parse(readFileSync(policyFile, 'utf8'));
  const s = summarize(report);
  const v = verdict(report, policy);
  console.log(`${s.os}: ${s.total} findings (${SEVERITIES.map((k) => `${s.bySeverity[k]} ${k.toLowerCase()}`).join(', ')}), ${s.fixable} fixable`);
  console.log(`fix now ${v.counts['fix-now']}, plan ${v.counts.plan}, accept ${v.counts.accept}`);
  for (const r of v.reasons) console.log(`FAIL: ${r}`);
  console.log(v.pass ? 'PASS' : 'FAIL');
  process.exit(v.pass ? 0 : 1);
}
