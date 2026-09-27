import Stripe from 'stripe'
import { env } from './server.js'

let _stripe: Stripe | null = null
export function stripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(env('STRIPE_SECRET_KEY'))
  return _stripe
}
