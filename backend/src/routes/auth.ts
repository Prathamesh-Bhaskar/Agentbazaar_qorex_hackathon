import type { FastifyInstance } from 'fastify';
import { and, eq, gt, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { createSession, newToken, requireUser } from '../lib/auth.js';
import { checkSignature, SIGN_IN_TTL_MS, signInMessage, walletAddress, walletSignature } from '../lib/signIn.js';
import { evmToQor } from '@qorechain/sdk';
import { hashPassword, loginThrottle, passwordProblem, verifyPassword } from '../lib/password.js';

const email = z.string().trim().toLowerCase().email().max(254);
const role = z.enum(['client', 'lister', 'both']);
const signed = z.object({ address: z.string(), nonce: z.string(), signature: walletSignature }); // signature: QoreX signArbitrary

type User = typeof schema.users.$inferSelect;
/** What the API may show about a user. Never the password hash. */
const publicUser = (u: User) => ({
  id: u.id, address: u.address, qorAddress: evmToQor(u.address), displayName: u.displayName, email: u.email, role: u.role,
  hederaAccountId: u.hederaAccountId, createdAt: u.createdAt, hasPassword: !!u.passwordHash,
});

/** Check the one-time nonce and the QoreX signature over our sign-in text. Burns the nonce. Returns the user key (0x form). */
async function checkWallet(body: z.infer<typeof signed>): Promise<{ addr: string } | { status: number; error: string; code: string }> {
  const wallet = walletAddress(body.address);
  if (!wallet) return { status: 400, error: 'Invalid address', code: 'bad_address' };
  const unused = and(eq(schema.authNonces.address, wallet.hex), eq(schema.authNonces.nonce, body.nonce), eq(schema.authNonces.used, false), gt(schema.authNonces.expiresAt, new Date()));
  const [row] = await db.select().from(schema.authNonces).where(unused).limit(1);
  if (!row) return { status: 400, error: 'Unknown, used or expired nonce', code: 'bad_nonce' };
  const failure = await checkSignature(wallet.qor, signInMessage({ qor: wallet.qor, nonce: row.nonce, expiresAt: row.expiresAt }), body.signature);
  if (failure) return failure;
  // Burn it in one statement, so two requests with the same signature cannot both succeed.
  const burned = await db.update(schema.authNonces).set({ used: true }).where(unused).returning({ nonce: schema.authNonces.nonce });
  if (!burned.length) return { status: 400, error: 'Unknown, used or expired nonce', code: 'bad_nonce' };
  return { addr: wallet.hex };
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/nonce', async (req, reply) => {
    const { address } = z.object({ address: z.string() }).parse(req.body);
    const wallet = walletAddress(address);
    if (!wallet) return reply.code(400).send({ error: 'Invalid address' });
    const nonce = newToken(16);
    const expiresAt = new Date(Date.now() + SIGN_IN_TTL_MS);
    await db.insert(schema.authNonces).values({ address: wallet.hex, nonce, expiresAt });
    // Tells the page whether to ask for a password. (An address is public, so this reveals nothing secret.)
    const [user] = await db.select({ passwordHash: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.address, wallet.hex)).limit(1);
    return { nonce, message: signInMessage({ qor: wallet.qor, nonce, expiresAt }), expiresAt, isNew: !user, passwordRequired: !!user?.passwordHash };
  });

  // Log in: wallet signature, plus the password if this account has one.
  app.post('/auth/verify', async (req, reply) => {
    const body = signed.extend({ password: z.string().max(128).optional() }).parse(req.body);
    const w = await checkWallet(body);
    if ('error' in w) return reply.code(w.status).send({ error: w.error, code: w.code });

    let [user] = await db.select().from(schema.users).where(eq(schema.users.address, w.addr)).limit(1);
    if (user?.passwordHash) {
      const wait = loginThrottle.blockedFor(w.addr);
      if (wait) return reply.code(429).send({ error: `Too many wrong passwords. Try again in ${Math.ceil(wait / 60)} minute(s).`, code: 'throttled' });
      if (!body.password) return reply.code(401).send({ error: 'This account is protected by a password.', code: 'password_required' });
      if (!(await verifyPassword(body.password, user.passwordHash))) {
        loginThrottle.fail(w.addr);
        return reply.code(401).send({ error: 'Wrong password.', code: 'wrong_password' });
      }
      loginThrottle.clear(w.addr);
    }
    // A wallet that has never been here is created on first sign-in (wallet-only account).
    if (!user) [user] = await db.insert(schema.users).values({ address: w.addr }).returning();

    const session = await createSession(user.id);
    return { token: session.token, expiresAt: session.expiresAt, user: publicUser(user) };
  });

  // Sign up: wallet signature + email + password. Also upgrades a wallet-only account that has no password yet.
  app.post('/auth/signup', async (req, reply) => {
    const body = signed.extend({ email, password: z.string().max(128), displayName: z.string().trim().min(1).max(60).optional(), role: role.optional() }).parse(req.body);
    const problem = passwordProblem(body.password);
    if (problem) return reply.code(400).send({ error: problem, code: 'weak_password' });

    const w = await checkWallet(body);
    if ('error' in w) return reply.code(w.status).send({ error: w.error, code: w.code });

    const [existing] = await db.select().from(schema.users).where(eq(schema.users.address, w.addr)).limit(1);
    if (existing?.passwordHash) return reply.code(409).send({ error: 'This wallet already has an account. Log in instead.', code: 'account_exists' });
    const [taken] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, body.email)).limit(1);
    if (taken && taken.id !== existing?.id) return reply.code(409).send({ error: 'That email is already used by another account.', code: 'email_taken' });

    const fields = { email: body.email, passwordHash: await hashPassword(body.password), ...(body.displayName ? { displayName: body.displayName } : {}), ...(body.role ? { role: body.role } : {}) };
    let user: User;
    try {
      [user] = existing
        ? await db.update(schema.users).set(fields).where(eq(schema.users.id, existing.id)).returning()
        : await db.insert(schema.users).values({ address: w.addr, ...fields }).returning();
    } catch {
      return reply.code(409).send({ error: 'That email is already used by another account.', code: 'email_taken' });
    }
    const session = await createSession(user.id);
    return reply.code(201).send({ token: session.token, expiresAt: session.expiresAt, user: publicUser(user) });
  });

  app.get('/me', { preHandler: requireUser }, async (req) => {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, req.user!.id)).limit(1);
    return publicUser(user);
  });

  app.patch('/me', { preHandler: requireUser }, async (req, reply) => {
    const body = z.object({ displayName: z.string().trim().min(1).max(60).optional(), role: role.optional() }).parse(req.body);
    if (!Object.keys(body).length) return reply.code(400).send({ error: 'Nothing to update' });
    const [user] = await db.update(schema.users).set(body).where(eq(schema.users.id, req.user!.id)).returning();
    return publicUser(user);
  });

  // Change the password. Needs the current one; every other session is signed out.
  app.post('/me/password', { preHandler: requireUser }, async (req, reply) => {
    const body = z.object({ currentPassword: z.string().max(128), newPassword: z.string().max(128) }).parse(req.body);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, req.user!.id)).limit(1);
    if (!user.passwordHash) return reply.code(409).send({ error: 'This account has no password yet. Add one from the sign-up form.', code: 'no_password' });
    const key = `pw:${user.id}`;
    const wait = loginThrottle.blockedFor(key);
    if (wait) return reply.code(429).send({ error: `Too many wrong passwords. Try again in ${Math.ceil(wait / 60)} minute(s).`, code: 'throttled' });
    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
      loginThrottle.fail(key);
      return reply.code(401).send({ error: 'Current password is wrong.', code: 'wrong_password' });
    }
    loginThrottle.clear(key);
    const problem = passwordProblem(body.newPassword);
    if (problem) return reply.code(400).send({ error: problem, code: 'weak_password' });
    await db.update(schema.users).set({ passwordHash: await hashPassword(body.newPassword) }).where(eq(schema.users.id, user.id));
    const current = (req.headers.authorization ?? '').slice(7);
    await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, user.id), ne(schema.sessions.id, current)));
    return { ok: true };
  });
}
