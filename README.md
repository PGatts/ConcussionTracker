# Happy Head
## Inspiration
Happy Head was inspired because half of the team has had concussions in the past and one of us received one as recently as last week in which he continued to play in his sport half-conscious for 20 minutes following the hit. This inspired us to see what we could do about concussion safety as engineers and make sure that concussions that may have gone unseen are detected.

## What it does
Happy Head monitors acceleration data inside of player's helmets/equipment and will display certain emojis, send data to database utilizing USART, and give text-to-speech based on the acceleration the player experiences in an effort for coaches, athletes, and medical staff to become more aware of potentially concussive collisions. Happy Head also stores this information along with timestamps in a database that can be looked through on a website after the game is over for future review of plays. 

Check it out at here: https://happy-head.vercel.app

## How we built it
We built this by integrating hardware sensors, embedded programming, data communication systems, a camera, computer vision, and a web application. Our design starts with a Texas Instruments Launchpad microcontroller in which we interfaced with a BMI160 IMU using I2C protocol to use its accelerometer and gyroscope. It also interfaces with a LCD TFT panel using SPI which draws a happy face sprite until a concussive hit is detected. At the same time the system uses USART communication to transmit the magnitude of the X, Y, and Z axis acceleration and the magnitude of the X, Y, and Z angular velocity to a computer which logs the data into a central database. If the value of either passes the threshold of a concussive hit then a text-to-speech alert is triggered ensuring that coaches and medical staff are alerted immediately and the LCD panel will draw a crying face animation. 

The website was built using the Next.js framework with supabase for the database. The frontend displays custom tables and charts using TanStack and Recharts to allow for dynamic, customizable filtering and sorting of data. Prisma was used as the orm to ensure type safe reading and writing from the postgreSQL database. The computer vision component was built using a camera, openCV, and mediapipe’s FaceMesh detection. Collisions were detected by checking for overlapping heads on all 3 axes and videos of each collision were saved.

## Challenges we ran into
One of the biggest challenges that we ran into on this project was communication as we had many different devices talk to each other with different protocols and performing their own processing of data. Interfacing our embedded system with a web application was also a challenge for our team as it was new to us and we are accustomed to using low level languages, especially with regards to wirelessly sending data from our microcontroller to the web application. Another challenge that we ran into was testing our project as we had some hardware break on us and we had to replace it and change our approaches.

## Accomplishments that we're proud of
We are proud of being able to have such a well interconnected system for such a low level project. As first time hackers we were very proud of being able to see how we could take data from a microcontroller and be able to have it make its way to a website that anyone could see. 

## What we learned
During this project we really got a chance to learn more about how to go about data logging and its intricacies. The project also really gave us a chance to work on our system design as we had many different systems at play and had to parallelize a lot of our workload. 

## What's next for Happy Head
On the hardware side we would optimize by designing ASIC's that are much smaller, lighter, wireless, and practical for athletes in live play. We would incorporate Bluetooth or Wi-Fi to eliminate the need for wired USART. On the data science side, the biggest expansion for this project would be the large amount of data we could collect on concussions relatively easily if these systems were used by a large amount of platers. The collected acceleration and gyroscope data could be correlated to diagnosed concussions allowing us to make much more advanced AI models for athletes. On the web app, we would expand by allowing medical staff to tag clips with notes, generate automated reports, and integrate with existing athlete health records. In practices maybe this can be used to identify patterns such as certain drills, positions, or plays that correlate with higher concussion risk. These expansions would help transform Happy Head from a monitoring prototype into a complete IoT prevention ecosystem protecting athletes of all types.
