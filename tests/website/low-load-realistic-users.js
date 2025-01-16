import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    real_user_journey: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },     // Ramp up to 50 users
        { duration: '2m', target: 50 },      // Stay at 50
        { duration: '30s', target: 0 },      // Ramp down
      ],
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
  const baseUrl = __ENV.BASE_URL
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


// results
{/*

     ✓ / status is 200
     ✓ / loads under 2s
     ✓ /blog status is 200
     ✗ /blog loads under 2s
      ↳  99% — ✓ 124 / ✗ 1
     ✓ /jobs status is 200
     ✗ /jobs loads under 2s
      ↳  99% — ✓ 378 / ✗ 2
     ✓ /about status is 200
     ✓ /about loads under 2s
     ✓ /blog/the-power-of-networking status is 200
     ✓ /blog/the-power-of-networking loads under 2s
     ✓ /candidates status is 200
     ✓ /candidates loads under 2s

     checks.........................: 99.91% 3483 out of 3486
     data_received..................: 32 MB  168 kB/s
     data_sent......................: 258 kB 1.3 kB/s
     http_req_blocked...............: avg=3.36ms   min=0s      med=1µs      max=343.42ms p(90)=3µs      p(95)=5µs     
     http_req_connecting............: avg=1.46ms   min=0s      med=0s       max=184.36ms p(90)=0s       p(95)=0s      
   ✓ http_req_duration..............: avg=154.06ms min=63.17ms med=141.35ms max=2.95s    p(90)=205.3ms  p(95)=248.09ms
       { expected_response:true }...: avg=154.06ms min=63.17ms med=141.35ms max=2.95s    p(90)=205.3ms  p(95)=248.09ms
   ✓ http_req_failed................: 0.00%  0 out of 1743
     http_req_receiving.............: avg=23.51ms  min=565µs   med=15.87ms  max=521.14ms p(90)=48.95ms  p(95)=53.71ms 
     http_req_sending...............: avg=454.06µs min=28µs    med=188µs    max=93.96ms  p(90)=330.8µs  p(95)=400.49µs
     http_req_tls_handshaking.......: avg=1.88ms   min=0s      med=0s       max=301.91ms p(90)=0s       p(95)=0s      
     http_req_waiting...............: avg=130.09ms min=53.69ms med=121.62ms max=2.93s    p(90)=175.69ms p(95)=213.75ms
     http_reqs......................: 1743   9.120033/s
     iteration_duration.............: avg=12.66s   min=5.36s   med=12.28s   max=23.87s   p(90)=17.71s   p(95)=20.11s  
     iterations.....................: 619    3.238841/s
     vus............................: 1      min=1            max=50
     vus_max........................: 50     min=50           max=50

     summary:
        📊 Overall Performance:
            Success Rate: 99.91% checks passed
            Zero failed requests
            9.12 requests per second
            32 MB data transferred

        ⚡ Response Times (Very Good):
            Average: 154.06ms
            Median: 141.35ms
            95th percentile: 248.09ms
            Maximum: 2.95s

        🔍 Page Performance:
            ✅ Perfect Performance (100% under 2s):
            Homepage (/)
            /about
            /candidates
            /blog/the-power-of-networking
            ⚠️ Minor Issues:
            /blog: 99% under 2s (1 slow request)
            /jobs: 99% under 2s (2 slow requests)

        🔬 Timing Breakdown:
            Server Processing (waiting): 130.09ms avg
            Download Time (receiving): 23.51ms avg
            Connection Setup: 3.36ms avg
            TLS Handshaking: 1.88ms avg

        🎯 Key Insights:
            System handles 50 concurrent users extremely well
            Only 3 requests out of 1,743 exceeded 2s threshold
            Very consistent response times
            Efficient server processing
    */}