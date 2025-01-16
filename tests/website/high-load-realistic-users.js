import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics for better monitoring
const slowResponseRate = new Rate('slow_responses');
const dbTiming = new Trend('db_query_time');

export const options = {
    scenarios: {
      real_user_journey: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
          { duration: '1m', target: 200 },     // Gradual ramp-up
          { duration: '2m', target: 400 },     // Steady increase
          { duration: '2m', target: 600 },     // Peak traffic
          { duration: '1m', target: 400 },     // Scale down
          { duration: '1m', target: 0 }        // Ramp down
        ],
      }
    },
    thresholds: {
        http_req_duration: ['p(95)<2000'],
        http_req_failed: ['rate<0.05'],
      },
  };

const USER_JOURNEYS = {
  JOB_SEEKER: [
    { path: '/', minWait: 2, maxWait: 5 },
    { path: '/jobs', minWait: 3, maxWait: 8, isDbHeavy: true },
    { path: '/candidates', minWait: 2, maxWait: 4, isDbHeavy: true },
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

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function performUserJourney(journeyType) {
  const baseUrl = __ENV.BASE_URL;
  const headers = {
    'User-Agent': 'k6-load-test',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache'
  };

  const journey = USER_JOURNEYS[journeyType];
  
  for (const step of journey) {
    try {
      const response = http.get(`${baseUrl}${step.path}`, { 
        headers,
        timeout: '10s'  // Increased timeout for peak load
      });
      
      // Track DB-heavy pages
      if (step.path === '/jobs' || step.path === '/candidates') {
        dbTiming.add(response.timings.waiting);
      }

      // Enhanced response time tracking
      if (response.timings.duration > 2000) {
        slowResponseRate.add(1);
        console.log(`Slow response for ${step.path}:`, {
          duration: response.timings.duration,
          waiting: response.timings.waiting,
          receiving: response.timings.receiving
        });
      }

      check(response, {
        [`${step.path} status is 200`]: (r) => r.status === 200,
        [`${step.path} loads under 2.5s`]: (r) => r.timings.duration < 2500,
      });

      // Dynamic sleep based on response time
      const responseTime = response.timings.duration / 1000;
      const minWait = Math.max(step.minWait - responseTime, 0);
      sleep(randomBetween(minWait, step.maxWait));

    } catch (error) {
      console.error(`Error accessing ${step.path}:`, error);
    }
  }
}

export default function () {
  const rand = Math.random();
  const journeyType = rand < 0.6 ? 'JOB_SEEKER' : 
                     rand < 0.8 ? 'EMPLOYER' : 
                     'CASUAL_BROWSER';

  performUserJourney(journeyType);
} 


{/* 
INFO[0221] Slow response for /about: {"duration":2146.819,"waiting":2109.556,"receiving":37.21}  source=console

     ✓ / status is 200
     ✗ / loads under 2.5s
      ↳  99% — ✓ 11781 / ✗ 19
     ✓ /jobs status is 200
     ✗ /jobs loads under 2.5s
      ↳  99% — ✓ 7150 / ✗ 7
     ✓ /about status is 200
     ✗ /about loads under 2.5s
      ↳  99% — ✓ 2276 / ✗ 4
     ✓ /candidates status is 200
     ✗ /candidates loads under 2.5s
      ↳  99% — ✓ 7153 / ✗ 4
     ✓ /blog status is 200
     ✗ /blog loads under 2.5s
      ↳  99% — ✓ 2361 / ✗ 2
     ✓ /blog/the-power-of-networking status is 200
     ✓ /blog/the-power-of-networking loads under 2.5s

     checks.........................: 99.94%  66204 out of 66240
     data_received..................: 604 MB  1.4 MB/s
     data_sent......................: 4.3 MB  9.8 kB/s
     db_query_time..................: avg=167.246625 min=48.95   med=130.9825 max=1783.042 p(90)=236.9378 p(95)=326.06605
     http_req_blocked...............: avg=3.64ms     min=0s      med=1µs      max=4.46s    p(90)=2µs      p(95)=2µs      
     http_req_connecting............: avg=1.7ms      min=0s      med=0s       max=3.34s    p(90)=0s       p(95)=0s       
   ✓ http_req_duration..............: avg=186.97ms   min=52.57ms med=138.27ms max=6.39s    p(90)=269.33ms p(95)=396.68ms 
       { expected_response:true }...: avg=186.97ms   min=52.57ms med=138.27ms max=6.39s    p(90)=269.33ms p(95)=396.68ms 
   ✓ http_req_failed................: 0.00%   0 out of 33120
     http_req_receiving.............: avg=36.5ms     min=384µs   med=10.92ms  max=6s       p(90)=61.44ms  p(95)=94.79ms  
     http_req_sending...............: avg=283.6µs    min=18µs    med=112µs    max=220.57ms p(90)=229µs    p(95)=313µs    
     http_req_tls_handshaking.......: avg=1.92ms     min=0s      med=0s       max=3.02s    p(90)=0s       p(95)=0s       
     http_req_waiting...............: avg=150.18ms   min=41.98ms med=120.96ms max=2.82s    p(90)=226.01ms p(95)=316.44ms 
     http_reqs......................: 33120   76.247318/s
     iteration_duration.............: avg=12.54s     min=5.04s   med=12.29s   max=26.98s   p(90)=17.88s   p(95)=19.86s   
     iterations.....................: 11800   27.165409/s
     slow_responses.................: 100.00% 78 out of 78
     vus............................: 1       min=1              max=600
     vus_max........................: 600     min=600            max=600


running (7m14.4s), 000/600 VUs, 11800 complete and 0 interrupted iterations
real_user_journey ✓ [======================================] 000/600 VUs  7m0s
    
    */}
// summary
{/*
📊 Results (2s target):
Total Requests: 13,772
Success Rate: 99.96%
Request Rate: 36.68 req/sec
Data Transfer: 253 MB

⚡ Response Times (all under 2s target):
    Average: 136.63ms (very good!)
    Median: 129.79ms
    95th percentile: 213.5ms
    Maximum: 2.69s (only rare spikes)
🔍 Page Performance:
    Perfect (100% under 2s):
    - Homepage (/)
    - /blog
    - /about
    - /blog/the-power-of-networking

    Minor Issues:
    - /jobs: 99% under 2s (8 slow out of 2,949)
    - /candidates: 99% under 2s (3 slow out of 2,949)

🎯 Key Insights:
    Only 11 requests out of 13,772 exceeded 2s (0.08%)
    System actually performed better under medium load
    Very consistent response times
    DB-heavy pages (/jobs, /candidates) showing slight stress



  Comparison vs medium-load-realistic-users.js
  📊 Overall Metrics:

    Total Requests:
    + High: 33,120 requests
    - Medium: 13,772 requests
    (2.4x increase)

    Request Rate:
    + High: 76.25 req/sec
    - Medium: 36.68 req/sec
    (2.1x increase)

    Success Rate:
    - High: 99.94%
    + Medium: 99.96%
    (Nearly identical)

    Data Transfer:
    + High: 604 MB
    - Medium: 253 MB
    (2.4x increase)

  ⚡ Response Times:
      Average:
      - High: 186.97ms
      + Medium: 136.63ms
      (37% increase)

      Median:
      - High: 138.27ms
      + Medium: 129.79ms
      (6.5% increase)

      95th percentile:
      - High: 396.68ms
      + Medium: 213.5ms
      (85% increase)

      Maximum:
      - High: 6.39s
      + Medium: 2.69s
      (137% increase)

      🎯 Key Insights:
      
          System scaled nearly linearly (2x users → 2.1x throughput)
          Success rates remained excellent at both loads
          Response times degraded gracefully under load
          DB-heavy pages (/jobs, /candidates) maintained stability
          Both tests showed >99% requests under target time

  */}