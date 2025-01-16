import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    real_user_journey: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 100 },
        { duration: '2m', target: 200 },
        { duration: '2m', target: 300 },
        { duration: '1m', target: 0 },
      ]
    }
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.05'],
  },
};

// Helper function
function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

const USER_JOURNEYS = {
  JOB_SEEKER: [
    { path: '/', minWait: 2, maxWait: 5 },
    { path: '/jobs', minWait: 3, maxWait: 8 },
    { path: '/candidates', minWait: 2, maxWait: 4 },
  ],
  EMPLOYER: [
    { path: '/', minWait: 2, maxWait: 4 },
    { path: '/about', minWait: 3, maxWait: 6 }
  ],
  CASUAL_BROWSER: [
    { path: '/', minWait: 2, maxWait: 5 },
    { path: '/blog', minWait: 3, maxWait: 8 },
    { path: '/blog/the-power-of-networking', minWait: 5, maxWait: 12 }
  ]
};

function performUserJourney(journeyType) {
  const baseUrl = __ENV.BASE_URL;
  const headers = {
    'User-Agent': 'k6-load-test',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br'
  };

  const journey = USER_JOURNEYS[journeyType];
  
  for (const step of journey) {
    const response = http.get(`${baseUrl}${step.path}`, { headers });
    
    check(response, {
      [`${step.path} status is 200`]: (r) => r.status === 200,
      [`${step.path} loads under 2s`]: (r) => r.timings.duration < 2000,
    });

    if (response.timings.duration > 2000) {
      console.log(`Slow response for ${step.path}: ${response.timings.duration}ms`);
    }

    sleep(randomBetween(step.minWait, step.maxWait));
  }
}

export default function () {
  const rand = Math.random();
  const journeyType = rand < 0.6 ? 'JOB_SEEKER' : 
                     rand < 0.8 ? 'EMPLOYER' : 
                     'CASUAL_BROWSER';

  performUserJourney(journeyType);
} 

// summary
{/*
  📊 Overall Performance (Still Excellent!):
    + Success Rate: 99.96% (↑ from 99.91%)
    + Zero failed requests (same as low load)
    + 36.68 requests/second (↑ from 9.12/s)
    + 253 MB data transferred (↑ from 32 MB)
  ⚡ Response Times (Better Than Low Load!):
      Average: 136.63ms (↓ from 154.06ms)
      Median: 129.79ms (↓ from 141.35ms)
      95th percentile: 213.5ms (↓ from 248.09ms)
      Maximum: 2.69s (↓ from 2.95s)
  🔍 Page Performance:
      ✅ Perfect Performance (100% under 2s):
      Homepage (/)
      /blog
      /about
      /blog/the-power-of-networking
      ⚠️ Minor Issues:
      /jobs: 99% under 2s (8 slow requests out of 2,949)
      /candidates: 99% under 2s (3 slow requests out of 2,949)

  🔬 Timing Breakdown:
      Server Processing: 118.34ms avg (↓ from 130.09ms)
      Download Time: 18.04ms avg (↓ from 23.51ms)
      Connection Setup: 2.34ms avg (↓ from 3.36ms)
      TLS Handshaking: 1.36ms avg (↓ from 1.88ms)

  🎯 Key Insights:
      System performs BETTER under medium load
      More efficient processing with higher concurrency
      Only 11 requests out of 13,772 exceeded 2s
      Response times actually improved under load
*/}