"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";

export default function InaugurationIntro({
  children,
}: {
  children: React.ReactNode;
}) {
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    // Total inauguration duration: 12 seconds
    const timer = setTimeout(() => {
      setShowIntro(false);
    }, 12000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {/* =========================================
          NORMAL WEBSITE / HOMEPAGE
      ========================================== */}

      {children}

      {/* =========================================
          INAUGURATION INTRO
      ========================================== */}

      {showIntro && (
        <div
          className="
            fixed
            inset-0
            z-[9999]
            overflow-hidden
            bg-[#F7F7F7]
          "
        >
          {/* =====================================
              MATCHING LOGO BACKGROUND
          ====================================== */}

          <div className="absolute inset-0 bg-[#F7F7F7]" />

          {/* =====================================
              SUBTLE CENTER LIGHT
          ====================================== */}

          <motion.div
            className="
              absolute
              left-1/2
              top-1/2
              h-[75vh]
              w-[70vw]
              -translate-x-1/2
              -translate-y-1/2
              rounded-full
              bg-[#F7F7F7]
            "
            initial={{
              opacity: 0,
            }}
            animate={{
              opacity: 1,
            }}
            transition={{
              delay: 5,
              duration: 2,
              ease: "easeOut",
            }}
          />

          {/* =====================================
              LEFT RED VELVET CURTAIN
          ====================================== */}

          <motion.div
            className="
              absolute
              left-0
              top-0
              h-full
              w-[52%]
            "
            initial={{
              x: "0%",
            }}
            animate={{
              x: "-100%",
            }}
            transition={{
              delay: 1,
              duration: 4.5,
              ease: [0.76, 0, 0.24, 1],
            }}
          >
            {/* Main velvet fabric */}
            <div
              className="absolute inset-0"
              style={{
                background: `
                  repeating-linear-gradient(
                    90deg,
                    #210000 0px,
                    #3B0000 18px,
                    #650000 36px,
                    #8F0000 52px,
                    #6A0000 70px,
                    #350000 90px
                  )
                `,
              }}
            />

            {/* Velvet lighting */}
            <div
              className="absolute inset-0"
              style={{
                background: `
                  linear-gradient(
                    90deg,
                    rgba(0,0,0,0.65),
                    transparent 18%,
                    rgba(255,100,100,0.16) 35%,
                    rgba(0,0,0,0.10) 50%,
                    rgba(255,90,90,0.12) 65%,
                    rgba(0,0,0,0.70)
                  )
                `,
              }}
            />

            {/* Fabric folds */}
            <div
              className="absolute inset-0"
              style={{
                background: `
                  repeating-linear-gradient(
                    90deg,
                    transparent 0px,
                    rgba(0,0,0,0.38) 15px,
                    transparent 32px,
                    rgba(255,120,120,0.10) 48px,
                    transparent 64px
                  )
                `,
              }}
            />

            {/* Inner edge shadow */}
            <div
              className="
                absolute
                right-0
                top-0
                h-full
                w-20
                bg-gradient-to-l
                from-black/80
                to-transparent
              "
            />

            {/* Top shadow */}
            <div
              className="
                absolute
                left-0
                right-0
                top-0
                h-32
                bg-gradient-to-b
                from-black/70
                to-transparent
              "
            />

            {/* Bottom shadow */}
            <div
              className="
                absolute
                bottom-0
                left-0
                right-0
                h-32
                bg-gradient-to-t
                from-black/60
                to-transparent
              "
            />
          </motion.div>

          {/* =====================================
              RIGHT RED VELVET CURTAIN
          ====================================== */}

          <motion.div
            className="
              absolute
              right-0
              top-0
              h-full
              w-[52%]
            "
            initial={{
              x: "0%",
            }}
            animate={{
              x: "100%",
            }}
            transition={{
              delay: 1,
              duration: 4.5,
              ease: [0.76, 0, 0.24, 1],
            }}
          >
            {/* Main velvet fabric */}
            <div
              className="absolute inset-0"
              style={{
                background: `
                  repeating-linear-gradient(
                    90deg,
                    #350000 0px,
                    #6A0000 18px,
                    #8F0000 36px,
                    #650000 52px,
                    #3B0000 70px,
                    #210000 90px
                  )
                `,
              }}
            />

            {/* Velvet lighting */}
            <div
              className="absolute inset-0"
              style={{
                background: `
                  linear-gradient(
                    90deg,
                    rgba(0,0,0,0.70),
                    rgba(255,90,90,0.12) 25%,
                    rgba(0,0,0,0.10) 45%,
                    rgba(255,100,100,0.16) 65%,
                    transparent 82%,
                    rgba(0,0,0,0.65)
                  )
                `,
              }}
            />

            {/* Fabric folds */}
            <div
              className="absolute inset-0"
              style={{
                background: `
                  repeating-linear-gradient(
                    90deg,
                    transparent 0px,
                    rgba(0,0,0,0.38) 15px,
                    transparent 32px,
                    rgba(255,120,120,0.10) 48px,
                    transparent 64px
                  )
                `,
              }}
            />

            {/* Inner edge shadow */}
            <div
              className="
                absolute
                left-0
                top-0
                h-full
                w-20
                bg-gradient-to-r
                from-black/80
                to-transparent
              "
            />

            {/* Top shadow */}
            <div
              className="
                absolute
                left-0
                right-0
                top-0
                h-32
                bg-gradient-to-b
                from-black/70
                to-transparent
              "
            />

            {/* Bottom shadow */}
            <div
              className="
                absolute
                bottom-0
                left-0
                right-0
                h-32
                bg-gradient-to-t
                from-black/60
                to-transparent
              "
            />
          </motion.div>

          {/* =====================================
                         LOGO
          ====================================== */}

          <motion.div
            className="
              absolute
              inset-0
              z-20
              flex
              items-center
              justify-center
              px-6
            "
            initial={{
              opacity: 0,
              scale: 0.82,
            }}
            animate={{
              opacity: [0, 1, 1, 0],
              scale: [0.82, 1, 1, 1.02],
            }}
            transition={{
              // Curtains open first
              delay: 5.8,

              // Logo animation duration
              duration: 5,

              // Fade in → hold → fade out
              times: [0, 0.15, 0.82, 1],

              ease: "easeInOut",
            }}
          >
            {/* Very subtle logo backdrop */}

            <motion.div
              className="
                absolute
                h-[65vh]
                w-[75vw]
                max-w-[1100px]
                rounded-full
                bg-[#F7F7F7]
              "
              initial={{
                opacity: 0,
                scale: 0.9,
              }}
              animate={{
                opacity: [0, 0.7, 0.7, 0],
                scale: [0.9, 1, 1, 1.03],
              }}
              transition={{
                delay: 5.8,
                duration: 5,
                times: [0, 0.15, 0.82, 1],
                ease: "easeInOut",
              }}
            />

            {/* =================================
                        ACTUAL LOGO
            ================================== */}

            <img
              src="/inauglogo.jpeg"
              alt="DBCE Coders Club"
              className="
                relative
                z-10
                block
                h-auto
                w-[90vw]
                max-w-[1100px]
                object-contain
              "
            />
          </motion.div>

          {/* =====================================
              FINAL FADE INTO HOMEPAGE
          ====================================== */}

          <motion.div
            className="
              pointer-events-none
              absolute
              inset-0
              z-30
              bg-[#F7F7F7]
            "
            initial={{
              opacity: 0,
            }}
            animate={{
              opacity: [0, 0, 1],
            }}
            transition={{
              delay: 11.2,
              duration: 0.8,
              times: [0, 0.5, 1],
              ease: "easeInOut",
            }}
          />
        </div>
      )}
    </>
  );
}