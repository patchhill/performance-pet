function generateTestShifts(count = 100) {
  const shifts = [];
  const startDate = new Date('2024/03/20');
  
  const shiftPatterns = [
    { start: "09:00", end: "17:00" },  // Standard day shift
    { start: "14:00", end: "22:00" },  // Evening shift
    { start: "16:00", end: "00:00" },  // Late to midnight
    { start: "00:00", end: "08:00" }   // Midnight to morning
  ];
  
  for (let i = 0; i < count; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + Math.floor(i / 4)); // 4 shifts per day
    
    const formattedDate = date.toISOString().split('T')[0].replace(/-/g, '/');
    const shiftPattern = shiftPatterns[i % 4];
    
    const shift = {
      date: formattedDate,
      startTime: shiftPattern.start,
      endTime: shiftPattern.end,
      breakTime: 30,
      breakPaid: i % 2 === 0,
      rate: 25.50 + (i % 5),
      jobId: "cm64ly8v3000013gvb9ceypch", // Example job ID
      status: "available",
      cost: 204 + (i % 10) * 5,
      metadata: {
        location: ["Main Office", "Branch A", "Branch B", "Remote"][i % 4],
        department: ["Sales", "Support", "Admin", "IT"][i % 4]
      },
      tags: [
        { name: ["Morning", "Afternoon", "Evening", "Night"][i % 4] },
        { name: ["Weekday", "Weekend"][Math.floor(i / 20) % 2] }
      ]
    };
    
    shifts.push(shift);
  }
  
  return { shifts };
}

// Generate the data and write to file
const testData = generateTestShifts(100);
const fs = require('fs');

fs.writeFileSync('test-shifts.json', JSON.stringify(testData, null, 2));
console.log('Test shifts have been written to test-shifts.json'); 